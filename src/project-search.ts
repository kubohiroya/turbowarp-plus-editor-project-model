// The judgement for broadcast blocks lives in project-messages, which the layout's message
// section also uses, so the section and this search agree.
import {messageReference} from './project-messages.ts';
import {literalSearchMatches} from './literal-search.ts';
export {literalSearchPattern} from './literal-search.ts';

type Field = {id?: string; value: unknown};
type Block = {
    id: string;
    opcode: string;
    next?: string;
    shadow?: boolean;
    fields?: Record<string, Field>;
    inputs?: Record<string, {block?: string; shadow?: string}>;
    mutation?: {proccode?: string; blockInfo?: {text?: string}};
};
type Asset = {name: string};
type Comment = {text: string; blockId?: string | null};
type Variable = {name: string; type?: string; isCloud?: boolean; value?: unknown};
type Target = {
    id: string;
    isStage: boolean;
    isOriginal: boolean;
    getName(): string;
    getCostumes(): Asset[];
    getSounds(): Asset[];
    variables: Record<string, Variable>;
    comments?: Record<string, Comment>;
    // The VM answers `undefined` for a missing id, including an input with no block.
    blocks: {getScripts(): string[]; getBlock(id: string | undefined): Block | undefined};
};
export type SearchProject = {
    targets: Target[];
    getLabelForOpcode?(opcode: string): {category?: string; label?: string} | undefined;
    resetAllCaches?(): void;
    emitProjectChanged?(): void;
    on?(event: 'PROJECT_CHANGED', listener: () => void): void;
    removeListener?(event: 'PROJECT_CHANGED', listener: () => void): void;
};
type BlockKind = 'block' | 'variable' | 'list' | 'message' | 'argument' | 'extension';
type AssetKind = 'costume' | 'backdrop' | 'sound';
export type SearchKind = BlockKind | AssetKind | 'comment' | 'yaml';
export type VariableAccess = 'read' | 'write';
export type VariableSearch = {ownerId: string; variableId: string; access: VariableAccess};
export const variableAccessLabels = {
    read: ['読み取り', 'Read'],
    write: ['変更', 'Write']
} as const;
export type SearchEdit =
    | {type: 'field'; id: string; field: string; value: string}
    | {type: 'name'; id: string; owner: Target; name: string; variableType: string}
    | {type: 'procedure'; name: string}
    | {type: 'comment'; text: string};
export type ProjectSearchResult = {label: string; target: Target; detail?: string; edit?: SearchEdit} & (
    {kind: BlockKind; block: Block; variableAccess?: VariableAccess} | {kind: AssetKind; asset: Asset} |
    {kind: 'comment'; comment: Comment; commentId: string}
);
export type YamlSearchDocument = {reference: {providerId: string; documentId: string}; filename: string; source: string};
export type YamlSearchResult = {
    kind: 'yaml'; document: YamlSearchDocument; label: string; detail: string;
    range: {start: number; end: number; expectedText: string};
};
export type SearchResult = ProjectSearchResult | YamlSearchResult;

const headings: Record<Exclude<SearchKind, 'yaml'>, [string, string]> = {
    block: ['ブロック', 'Blocks'],
    variable: ['変数の使用箇所', 'Variable uses'],
    list: ['リストの使用箇所', 'List uses'],
    message: ['メッセージの送受信', 'Broadcasts'],
    argument: ['ブロックの引数値', 'Block argument values'],
    extension: ['機能拡張の使用箇所', 'Extension uses'],
    comment: ['コメント', 'Comments'],
    costume: ['コスチューム', 'Costumes'],
    backdrop: ['背景', 'Backdrops'],
    sound: ['音', 'Sounds']
};

function* walkBlocks(target: Target) {
    const pending = target.blocks.getScripts().slice().reverse();
    const seen = new Set<string>();
    while (pending.length) {
        const id = pending.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const block = target.blocks.getBlock(id);
        if (!block || block.shadow) continue;
        const inputs: [string, Block][] = [];
        for (const [key, input] of Object.entries(block.inputs ?? {})) {
            const child = input.block && target.blocks.getBlock(input.block);
            if (child) inputs.push([key, child]);
        }
        if (block.next) pending.push(block.next);
        for (let i = inputs.length - 1; i >= 0; i--) {
            if (!inputs[i][1].shadow) pending.push(inputs[i][1].id);
        }
        yield {block, inputs};
    }
}

const stageProperties = new Set(['background #', 'backdrop #', 'backdrop name', 'volume']);
const spriteProperties = new Set(['x position', 'y position', 'direction', 'costume #', 'costume name', 'size', 'volume']);

const listAccesses = new Map<string, VariableAccess>([
    ['data_listcontents', 'read'], ['data_itemoflist', 'read'], ['data_itemnumoflist', 'read'],
    ['data_lengthoflist', 'read'], ['data_listcontainsitem', 'read'],
    ['data_addtolist', 'write'], ['data_deleteoflist', 'write'], ['data_deletealloflist', 'write'],
    ['data_insertatlist', 'write'], ['data_replaceitemoflist', 'write']
]);

function variableAccess(target: Target, block: Block, inputs: [string, Block][],
    stage: Target | undefined, sprites: ReadonlyMap<string, Target>):
    {owner: Target; variableId: string; access: VariableAccess} | undefined {
    if (block.opcode === 'sensing_of') {
        const menu = inputs.find(([key]) => key === 'OBJECT')?.[1];
        if (!menu?.shadow || menu.opcode !== 'sensing_of_object_menu') return;
        const object = menu.fields?.OBJECT?.value;
        const name = block.fields?.PROPERTY?.value;
        if (typeof object !== 'string' || typeof name !== 'string') return;
        const owner = object === '_stage_' ? stage : sprites.get(object);
        if (!owner || (owner.isStage ? stageProperties : spriteProperties).has(name)) return;
        const variableId = Object.keys(owner.variables).find(id => {
            const variable = owner.variables[id];
            return variable.type === '' && variable.name === name;
        });
        if (variableId) return {owner, variableId, access: 'read'};
        return;
    }
    const listAccess = listAccesses.get(block.opcode);
    const access = listAccess ?? (block.opcode === 'data_variable' ? 'read' :
        block.opcode === 'data_setvariableto' || block.opcode === 'data_changevariableby' ? 'write' : undefined);
    const variableId = block.fields?.[listAccess ? 'LIST' : 'VARIABLE']?.id;
    if (!access || !variableId) return;
    const owner = Object.hasOwn(target.variables, variableId) ? target : stage;
    if (owner?.variables[variableId]?.type === (listAccess ? 'list' : '')) return {owner, variableId, access};
}

const originalSprites = (project: SearchProject) =>
    new Map(project.targets.filter(target => target.isOriginal && !target.isStage).map(target => [target.getName(), target]));

export function countVariableAccesses(project: SearchProject, ownerId: string) {
    const stage = project.targets.find(target => target.isStage);
    const sprites = originalSprites(project);
    const counts = new Map<string, Record<VariableAccess, number>>();
    for (const target of project.targets) {
        if (!target.isOriginal) continue;
        for (const {block, inputs} of walkBlocks(target)) {
            const use = variableAccess(target, block, inputs, stage, sprites);
            if (use?.owner.id !== ownerId) continue;
            const count = counts.get(use.variableId) ?? {read: 0, write: 0};
            count[use.access]++;
            counts.set(use.variableId, count);
        }
    }
    return counts;
}

export function searchProject(project: SearchProject, messages: Record<string, string>, query: string, japanese: boolean,
    kinds: ReadonlySet<SearchKind> = new Set(Object.keys(headings) as SearchKind[]), variableSearch?: VariableSearch) {
    const groups = new Map(Object.entries(headings).map(([kind, titles]) => [
        kind as SearchKind, {kind: kind as SearchKind, title: titles[japanese ? 0 : 1], results: [] as ProjectSearchResult[]}
    ]));
    const search = query.trim().normalize('NFC').toLocaleLowerCase();
    if (!search && !variableSearch) return [];

    const stage = project.targets.find(target => target.isStage);
    const sprites = variableSearch || kinds.has('variable') ? originalSprites(project) : undefined;
    const searchBlocks = variableSearch || (['block', 'variable', 'list', 'message', 'argument', 'extension'] as const)
        .some(kind => kinds.has(kind));
    const templates = new Map<string, {text: string; extension?: string}>();
    const matches = (value: string) => value.normalize('NFC').toLocaleLowerCase().includes(search);
    const describeOpcode = (opcode: string) => {
        const cached = templates.get(opcode);
        if (cached) return cached;
        const key = opcode.toUpperCase();
        const alternate = key.replace(/^OPERATOR_/, 'OPERATORS_').replace(/_AS_CLONE$/, 'ASCLONE');
        const vmLabel = project.getLabelForOpcode?.(opcode);
        const vmText = vmLabel?.label;
        const separator = vmLabel?.category === 'extension' ? vmText?.indexOf(': ') ?? -1 : -1;
        const template = {
            text: messages[key] ?? messages[alternate] ??
                (vmText && separator > 0 ? vmText.slice(separator + 2) : vmText) ?? opcode.replaceAll('_', ' '),
            extension: vmText && separator > 0 ? vmText.slice(0, separator) : undefined
        };
        templates.set(opcode, template);
        return template;
    };
    const fieldText = (target: Target, key: string, field: Field) => {
        const variable = field.id && (key === 'VARIABLE' || key === 'LIST') ?
            target.variables[field.id] ?? stage?.variables[field.id] : undefined;
        return String(variable?.name ?? field.value ?? '');
    };
    const describe = (target: Target, block: Block, inputs: [string, Block][], template: string) => {
        const values = [
            ...Object.entries(block.fields ?? {}).map(([key, field]) => fieldText(target, key, field)),
            ...inputs.filter(([key]) => !key.startsWith('SUBSTACK')).map(([, child]) =>
                child.shadow ? Object.values(child.fields ?? {}).map(field => String(field.value ?? '')).join(' ') :
                    Object.entries(child.fields ?? {}).map(([key, field]) => fieldText(target, key, field)).join(' ') || '…')
        ];
        if (block.opcode === 'event_whenflagclicked') values.unshift(japanese ? '緑の旗' : 'green flag');
        if (/%\d+/.test(template)) return template.replace(/%(\d+)/g, (_, index) => values[Number(index) - 1] ?? '…').trim();
        return [template, ...values].filter(Boolean).join(' ');
    };

    for (const target of project.targets) {
        if (!target.isOriginal) continue;
        for (const {block, inputs} of searchBlocks ? walkBlocks(target) : []) {
            const use = sprites && variableAccess(target, block, inputs, stage, sprites);
            if (variableSearch && (!use || use.owner.id !== variableSearch.ownerId ||
                use.variableId !== variableSearch.variableId || use.access !== variableSearch.access)) continue;

            const variable = block.fields?.VARIABLE;
            const list = block.fields?.LIST;
            const message = messageReference(target, block, stage);
            const kind = variable ? 'variable' : list ? 'list' : 'message';
            const reference = variable ?? list ?? (message && {id: message.id, value: message.fieldValue});
            const name = variable || list ? fieldText(target, variable ? 'VARIABLE' : 'LIST', reference!) : message?.name;
            const opcode = describeOpcode(block.opcode);
            const procedure = block.mutation?.proccode ??
                inputs.find(([key]) => key === 'custom_block')?.[1].mutation?.proccode;
            const customLabel = block.mutation?.blockInfo?.text;
            const template = procedure ? procedure.replace(/%[sbn]/g, '…') :
                typeof customLabel === 'string' ? customLabel : opcode.text;
            const label = procedure ? template : describe(target, block, inputs, template);
            const add = (kind: BlockKind, label: string, detail?: string, edit?: SearchEdit, access?: VariableAccess) =>
                groups.get(kind)!.results.push({kind, target, block, label, detail, edit, variableAccess: access});
            if (variableSearch && use) {
                add(list ? 'list' : 'variable', label, use.owner.variables[use.variableId].name, undefined, use.access);
                continue;
            }
            if (kinds.has('block') && (matches(template) || matches(block.opcode) ||
                (block.opcode === 'event_whenflagclicked' && matches(japanese ? '緑の旗' : 'green flag')))) {
                add('block', label, undefined, procedure ? {type: 'procedure', name: procedure} : undefined);
            }
            if (kinds.has(kind) && name && matches(name)) {
                const referenceId = reference?.id;
                const owner = referenceId &&
                    (target.variables[referenceId] ? target : stage?.variables[referenceId] ? stage : undefined);
                const scope = (variable || list) && owner &&
                    (owner.isStage ? (japanese ? '全体' : 'Global') : (japanese ? 'このスプライト' : 'Local'));
                const model = owner && referenceId ? owner.variables[referenceId] : undefined;
                const edit = owner && referenceId && model && !model.isCloud ? {
                    type: 'name' as const, id: referenceId, owner, name: model.name,
                    variableType: model.type ?? (list ? 'list' : message ? 'broadcast_msg' : '')
                } : undefined;
                add(kind, name, scope || label, edit, use?.access);
            } else if (use && !variable && !list && kinds.has('variable') && matches(use.owner.variables[use.variableId].name)) {
                add('variable', use.owner.variables[use.variableId].name, label, undefined, use.access);
            }
            if (kinds.has('extension') && opcode.extension && matches(opcode.extension)) add('extension', opcode.extension, label);
            if (kinds.has('argument')) {
                const addArguments = (owner: Block) => {
                    for (const [key, field] of Object.entries(owner.fields ?? {})) {
                        if (field === reference || (message && key === 'BROADCAST_OPTION')) continue;
                        const value = String(field.value ?? '');
                        if (value && matches(value)) add('argument', value, label,
                            {type: 'field', id: owner.id, field: key, value});
                    }
                };
                addArguments(block);
                for (const [, child] of inputs) {
                    if (child.shadow) addArguments(child);
                }
            }
        }
        if (variableSearch) continue;

        if (kinds.has('comment')) {
            for (const [commentId, comment] of Object.entries(target.comments ?? {})) {
                if (matches(comment.text)) groups.get('comment')!.results.push({
                    kind: 'comment', target, comment, commentId, label: comment.text, edit: {type: 'comment', text: comment.text}
                });
            }
        }

        const assets: [AssetKind, Asset[]][] = [
            [target.isStage ? 'backdrop' : 'costume', target.getCostumes()],
            ['sound', target.getSounds()]
        ];
        for (const [kind, items] of assets) {
            if (!kinds.has(kind)) continue;
            for (const asset of items) {
                if (matches(asset.name)) groups.get(kind)!.results.push({kind, asset, label: asset.name, target});
            }
        }
    }
    return [...groups.values()].filter(group => group.results.length);
}

export function searchYamlDocuments(documents: readonly YamlSearchDocument[], query: string, japanese: boolean) {
    const results: YamlSearchResult[] = [];
    const search = query.trim();
    if (!search) return results;
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const {filename} of documents) {
        if (seen.has(filename)) duplicates.add(filename);
        seen.add(filename);
    }
    for (const document of documents) {
        let line = 1;
        let lineStart = 0;
        let newline = document.source.indexOf('\n');
        for (const range of literalSearchMatches(document.source, search)) {
            const {start, end} = range;
            while (newline >= 0 && newline < start) {
                line++;
                lineStart = newline + 1;
                newline = document.source.indexOf('\n', lineStart);
            }
            const column = start - lineStart + 1;
            const nextNewline = document.source.indexOf('\n', end);
            const before = Math.max(lineStart, start - 48);
            const lineEnd = nextNewline < 0 ? document.source.length : nextNewline;
            const after = Math.min(lineEnd, end + 48);
            const position = japanese ? `${line} 行 ${column} 列` : `Line ${line}, column ${column}`;
            const identity = duplicates.has(document.filename) ?
                `${document.reference.providerId}/${document.reference.documentId}` : '';
            results.push({
                kind: 'yaml', document, label: `${before > lineStart ? '…' : ''}${document.source.slice(before, after)}${after < lineEnd ? '…' : ''}`,
                detail: [position, identity].filter(Boolean).join(' · '),
                range
            });
        }
    }
    return results;
}
