/**
 * Broadcast message scanning for the message section and for the host's project search.
 *
 * This module is the only place that decides which block sends or receives a message, so the
 * section and the host's search can never disagree. It takes the runtime through structural
 * types and never imports the VM or the GUI.
 */

type Field = {id?: string; value?: unknown};

type Block = {
    id: string;
    opcode: string;
    next?: string | null;
    shadow?: boolean;
    fields?: Record<string, Field>;
    inputs?: Record<string, {block?: string | null; shadow?: string | null}>;
};

type Blocks = {
    getScripts(): readonly string[];
    getBlock(id: string): Block | undefined;
};

type MessageVariable = {name: string; type?: string};

export type MessageTarget = {
    id: string;
    isStage: boolean;
    isOriginal: boolean;
    getName(): string;
    variables: Record<string, MessageVariable>;
    blocks: Blocks;
};

export type MessageProject = {targets: readonly MessageTarget[]};

export const broadcastVariableType = 'broadcast_msg';
export const sendOpcodes = ['event_broadcast', 'event_broadcastandwait'] as const;
export const receiveOpcode = 'event_whenbroadcastreceived';

export type MessageDirection = 'send' | 'receive';

export interface MessageReference {
    direction: MessageDirection;
    /** The broadcast_msg variable this block names, when it names one. */
    id?: string;
    /** The dropdown's own text, which is what the project file stores. */
    fieldValue: string;
    /** The owning variable's name when it resolves, otherwise the dropdown text. */
    name: string;
    /** `event_broadcastandwait` waits for every receiving script to finish. */
    wait: boolean;
}

/**
 * The judgement for a single block. Returns nothing for blocks that are not broadcast blocks and
 * for a broadcast whose message is a reporter, because that message is only known while running.
 */
export function messageReference(target: MessageTarget, block: Block,
    stage?: MessageTarget): MessageReference | undefined {
    const direction: MessageDirection | undefined = block.opcode === receiveOpcode ? 'receive' :
        (sendOpcodes as readonly string[]).includes(block.opcode) ? 'send' : undefined;
    if (!direction) return undefined;
    const input = block.inputs?.BROADCAST_INPUT;
    const menu = input?.block ? target.blocks.getBlock(input.block) : undefined;
    const field = block.fields?.BROADCAST_OPTION ?? menu?.fields?.BROADCAST_OPTION;
    if (!field) return undefined;
    const fieldValue = String(field.value ?? '');
    const owner = field.id ? target.variables[field.id] ?? stage?.variables[field.id] : undefined;
    return {
        direction,
        id: field.id,
        fieldValue,
        name: owner?.type === broadcastVariableType && owner.name ? owner.name : fieldValue,
        wait: block.opcode === 'event_broadcastandwait'
    };
}

export interface MessageUse extends MessageReference {
    key: string;
    targetId: string;
    targetName: string;
    isStage: boolean;
    blockId: string;
    opcode: string;
    /** The top block of the script holding this block, so the host can open the whole script. */
    scriptId: string;
    scriptOpcode: string;
    /** When that script starts with a "when I receive" hat, the message it waits for. */
    scriptMessageName?: string;
}

export type MessageStatus = 'both' | 'sendOnly' | 'receiveOnly' | 'unused';

export interface ProjectMessage {
    /** Stable identity for a message: its variable id, or its name when no variable owns it. */
    key: string;
    id?: string;
    name: string;
    status: MessageStatus;
    sends: readonly MessageUse[];
    receives: readonly MessageUse[];
}

const messageKey = (id: string | undefined, name: string) => id ?? 'name:' + name;

function* walkScripts(blocks: Blocks) {
    for (const rootId of blocks.getScripts()) {
        const root = blocks.getBlock(rootId);
        if (!root) continue;
        const pending = [rootId];
        const seen = new Set<string>();
        while (pending.length) {
            const id = pending.pop();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const block = blocks.getBlock(id);
            if (!block || block.shadow) continue;
            yield {root, block};
            if (block.next) pending.push(block.next);
            for (const input of Object.values(block.inputs ?? {})) {
                // A shadow holds a dropdown or a literal, which messageReference reads directly.
                if (input.block && input.block !== input.shadow) pending.push(input.block);
            }
        }
    }
}

const statusOf = (sends: readonly unknown[], receives: readonly unknown[]): MessageStatus =>
    sends.length && receives.length ? 'both' : sends.length ? 'sendOnly' : receives.length ? 'receiveOnly' : 'unused';

/** Every message in the project, with the places that send and receive it. */
export function scanProjectMessages(project: MessageProject): readonly ProjectMessage[] {
    const stage = project.targets.find(target => target.isStage);
    const found = new Map<string, {key: string; id?: string; name: string; sends: MessageUse[]; receives: MessageUse[]}>();
    const ensure = (id: string | undefined, name: string) => {
        const key = messageKey(id, name);
        let entry = found.get(key);
        if (!entry) {
            entry = {key, id, name, sends: [], receives: []};
            found.set(key, entry);
        }
        // A message created but never used still carries its variable name.
        if (name && entry.name !== name) entry.name = name;
        return entry;
    };

    for (const target of project.targets) {
        if (!target.isOriginal) continue;
        for (const [id, variable] of Object.entries(target.variables)) {
            if (variable.type === broadcastVariableType) ensure(id, variable.name);
        }
    }

    for (const target of project.targets) {
        if (!target.isOriginal) continue;
        const targetName = target.getName();
        for (const {root, block} of walkScripts(target.blocks)) {
            const reference = messageReference(target, block, stage);
            if (!reference) continue;
            const hat = root.opcode === receiveOpcode ? messageReference(target, root, stage) : undefined;
            const entry = ensure(reference.id, reference.name);
            const use: MessageUse = {
                ...reference,
                key: entry.key,
                targetId: target.id,
                targetName,
                isStage: target.isStage,
                blockId: block.id,
                opcode: block.opcode,
                scriptId: root.id,
                scriptOpcode: root.opcode,
                scriptMessageName: hat?.name
            };
            (reference.direction === 'send' ? entry.sends : entry.receives).push(use);
        }
    }

    return [...found.values()]
        .map(({key, id, name, sends, receives}) => ({key, id, name, sends, receives, status: statusOf(sends, receives)}))
        .sort((left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key));
}

export type MessageRenameError = 'emptyName' | 'duplicateName' | 'unavailable';

export type MessageRenameCheck = {error: MessageRenameError} | {name: string} | {unchanged: true};

/**
 * Whether a message may take this name. A message is owned by the stage, so its name has to be
 * free across the whole project.
 */
export function checkMessageRename(messages: readonly ProjectMessage[], message: ProjectMessage,
    name: string): MessageRenameCheck {
    const next = name.trim();
    if (!next) return {error: 'emptyName'};
    if (next === message.name) return {unchanged: true};
    const taken = next.toLocaleLowerCase();
    if (messages.some(other => other.key !== message.key && other.name.toLocaleLowerCase() === taken)) {
        return {error: 'duplicateName'};
    }
    return {name: next};
}

export interface MessageGraphNode {
    id: string;
    name: string;
    isStage: boolean;
}

export interface MessageGraphEdge {
    direction: MessageDirection;
    targetId: string;
    messageKey: string;
    /** How many blocks in that target send or receive the message. */
    count: number;
}

export interface MessageGraph {
    targets: readonly MessageGraphNode[];
    messages: readonly Pick<ProjectMessage, 'key' | 'id' | 'name' | 'status'>[];
    edges: readonly MessageGraphEdge[];
}

/** The whole project as sprite or stage, message, sprite or stage. Isolated messages are kept. */
export function projectMessageGraph(project: MessageProject,
    messages: readonly ProjectMessage[] = scanProjectMessages(project)): MessageGraph {
    const edges = new Map<string, MessageGraphEdge>();
    for (const message of messages) {
        for (const use of [...message.sends, ...message.receives]) {
            const key = use.direction + '\u0000' + use.targetId + '\u0000' + message.key;
            const edge = edges.get(key);
            if (edge) edge.count++;
            else edges.set(key, {direction: use.direction, targetId: use.targetId, messageKey: message.key, count: 1});
        }
    }
    return {
        targets: project.targets.filter(target => target.isOriginal)
            .map(target => ({id: target.id, name: target.getName(), isStage: target.isStage})),
        messages: messages.map(({key, id, name, status}) => ({key, id, name, status})),
        edges: [...edges.values()]
    };
}

export interface TargetMessages {
    targetId: string;
    isStage: boolean;
    /** Blocks in this target that send a message. */
    sends: readonly MessageUse[];
    /** Hats in this target that receive a message. */
    receives: readonly MessageUse[];
    /** Messages the project uses or declares that this target neither sends nor receives. */
    elsewhere: readonly ProjectMessage[];
    /** Every message in the project, so a rename can check the names already taken. */
    messages: readonly ProjectMessage[];
    /** The relationship diagram, which only the stage shows. */
    graph?: MessageGraph;
}

/** What one sprite or the stage sends and receives. The stage also carries the project diagram. */
export function scanTargetMessages(project: MessageProject, targetId: string): TargetMessages {
    const messages = scanProjectMessages(project);
    const isStage = Boolean(project.targets.find(target => target.id === targetId)?.isStage);
    const mine = (uses: readonly MessageUse[]) => uses.filter(use => use.targetId === targetId);
    const sends = messages.flatMap(message => mine(message.sends));
    const receives = messages.flatMap(message => mine(message.receives));
    return {
        targetId,
        isStage,
        sends,
        receives,
        elsewhere: messages.filter(message =>
            !message.sends.some(use => use.targetId === targetId) &&
            !message.receives.some(use => use.targetId === targetId)),
        messages,
        graph: isStage ? projectMessageGraph(project, messages) : undefined
    };
}
