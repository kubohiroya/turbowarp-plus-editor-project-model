import {literalSearchPattern, type ProjectSearchResult, type SearchProject, type SearchResult} from './project-search.ts';

type Field = {
    getValue(): unknown;
    setValue(value: string): void;
    callValidator(value: string): unknown;
    getOptions?(): ReadonlyArray<readonly [unknown, unknown]>;
};
type Comment = {getText(): string; setText(value: string): void};
type Block = {
    isEditable(): boolean;
    getField(name: string): Field | undefined;
    comment?: Comment;
    mutationToDom(): Element;
};
type RenameEvent = {type: string; varId?: string; newName?: string};
export type ReplaceWorkspace = {
    options: {readOnly: boolean};
    isDragging(): boolean;
    getBlockById(id: string): Block | null;
    getCommentById(id: string): Comment | null;
    getVariableById(id: string): {name: string} | null;
    renameVariableById(id: string, name: string): void;
    addChangeListener(listener: (event: RenameEvent) => void): void;
};
export type ReplaceBlockly = {
    FieldTextInput: abstract new (...args: never[]) => Field;
    FieldDropdown: abstract new (...args: never[]) => Field;
    FieldNumber: abstract new (...args: never[]) => Field;
    Procedures: {
        getPrototypeBlock(name: string, workspace: ReplaceWorkspace): Block | null;
        mutateCallersAndPrototype(name: string, workspace: ReplaceWorkspace, mutation: Element): void;
    };
};
export type ReplaceOutcome = 'applied' | 'staged' | 'stale' | 'conflict' | 'invalid' | 'read-only';

function spliceMatch(value: string, pattern: RegExp, replacement: string) {
    const match = pattern.exec(value);
    if (match) return value.slice(0, match.index) + replacement + value.slice(match.index + match[0].length);
}

function replaceProcedureLabel(name: string, pattern: RegExp, replacement: string) {
    if (/%[sbn]/.test(replacement)) return;
    const parts = name.split(/(%[sbn])/);
    for (let i = 0; i < parts.length; i += 2) {
        const changed = spliceMatch(parts[i], pattern, replacement);
        if (changed === undefined) continue;
        parts[i] = changed;
        const next = parts.join('');
        if (JSON.stringify(next.match(/%[sbn]/g)) === JSON.stringify(name.match(/%[sbn]/g))) return next;
        return;
    }
}

export function replacementText(result: SearchResult, query: string, replacement: string) {
    if (!query.trim()) return;
    if (result.kind === 'yaml') return replacement !== result.range.expectedText ? replacement : undefined;
    const edit = result.edit;
    if (!edit) return;
    const pattern = literalSearchPattern(query, 'iu');
    const source = edit.type === 'name' || edit.type === 'procedure' ? edit.name : edit.type === 'comment' ? edit.text : edit.value;
    const next = edit.type === 'procedure' ? replaceProcedureLabel(source, pattern, replacement) :
        spliceMatch(source, pattern, replacement);
    return next !== source ? next : undefined;
}

const watchedBroadcasts = new WeakMap<ReplaceWorkspace, Set<string>>();
function maintainBroadcastReferences(project: SearchProject, workspace: ReplaceWorkspace, id: string) {
    let ids = watchedBroadcasts.get(workspace);
    if (!ids) {
        const watched = new Set<string>();
        watchedBroadcasts.set(workspace, watched);
        ids = watched;
        workspace.addChangeListener(event => {
            if (event.type !== 'var_rename' || !event.varId || !watched.has(event.varId)) return;
            const variable = project.targets.find(target => target.isStage)?.variables[event.varId];
            if (variable?.type !== 'broadcast_msg' || variable.name !== event.newName || variable.value === variable.name) return;
            variable.value = variable.name;
            for (const blocks of new Set(project.targets.map(target => target.blocks))) {
                const pending = [...blocks.getScripts()];
                const seen = new Set<string>();
                while (pending.length) {
                    const id = pending.pop();
                    if (!id || seen.has(id)) continue;
                    seen.add(id);
                    const block = blocks.getBlock(id);
                    if (!block) continue;
                    const field = block.fields?.BROADCAST_OPTION;
                    if (field?.id === event.varId) field.value = variable.name;
                    if (block.next) pending.push(block.next);
                    for (const input of Object.values(block.inputs ?? {})) {
                        if (input.block) pending.push(input.block);
                        if (input.shadow) pending.push(input.shadow);
                    }
                }
            }
            project.resetAllCaches?.();
            project.emitProjectChanged?.();
        });
    }
    ids.add(id);
}

function validName(value: string) {
    return Boolean(value.trim()) && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Rename a message from the message section, where no block result carries the edit. */
export function renameProjectMessage(project: SearchProject, workspace: ReplaceWorkspace,
    id: string, next: string): ReplaceOutcome {
    if (workspace.options.readOnly || workspace.isDragging()) return 'read-only';
    const owner = project.targets.find(target => Object.hasOwn(target.variables, id));
    const variable = owner?.variables[id];
    if (variable?.type !== 'broadcast_msg' || workspace.getVariableById(id)?.name !== variable.name) return 'stale';
    if (!validName(next)) return 'invalid';
    const match = next.toLocaleLowerCase();
    if (project.targets.some(target => Object.entries(target.variables).some(([other, candidate]) =>
        other !== id && candidate.type === 'broadcast_msg' && candidate.name.toLocaleLowerCase() === match))) {
        return 'conflict';
    }
    maintainBroadcastReferences(project, workspace, id);
    workspace.renameVariableById(id, next);
    return workspace.getVariableById(id)?.name === next ? 'applied' : 'conflict';
}

export function applyProjectSearchReplacement(project: SearchProject, workspace: ReplaceWorkspace,
    Blockly: ReplaceBlockly, result: ProjectSearchResult, next: string): ReplaceOutcome {
    if (workspace.options.readOnly || workspace.isDragging() || !result.edit) return 'read-only';
    const {target, edit} = result;
    if (!project.targets.includes(target) || ('block' in result && target.blocks.getBlock(result.block.id) !== result.block)) return 'stale';
    if (edit.type === 'comment' && result.kind === 'comment') {
        const current = target.comments?.[result.commentId];
        if (current !== result.comment || current.text !== edit.text) return 'stale';
        const comment = current.blockId ? workspace.getBlockById(current.blockId)?.comment : workspace.getCommentById(result.commentId);
        if (!comment || comment.getText() !== edit.text) return 'stale';
        comment.setText(next);
        return 'applied';
    }
    if (edit.type === 'name') {
        if (!('block' in result)) return 'stale';
        const fieldName = result.kind === 'variable' ? 'VARIABLE' : result.kind === 'list' ? 'LIST' : 'BROADCAST_OPTION';
        const field = result.block.fields?.[fieldName] ??
            target.blocks.getBlock(result.block.inputs?.BROADCAST_INPUT?.block)?.fields?.[fieldName];
        if (field?.id !== edit.id) return 'stale';
        const variable = edit.owner.variables[edit.id];
        const model = workspace.getVariableById(edit.id);
        if (!project.targets.includes(edit.owner) || !variable || variable.name !== edit.name || model?.name !== edit.name) return 'stale';
        if (!validName(next) || variable.isCloud) return 'invalid';
        const scope = edit.owner.isStage ? project.targets.filter(target => target.isOriginal) :
            project.targets.filter(target => target === edit.owner || target.isStage);
        const match = next.toLocaleLowerCase();
        if (scope.some(target => Object.entries(target.variables).some(([id, candidate]) =>
            id !== edit.id && (candidate.type ?? '') === edit.variableType && candidate.name.toLocaleLowerCase() === match))) return 'conflict';
        if (edit.variableType === 'broadcast_msg') maintainBroadcastReferences(project, workspace, edit.id);
        workspace.renameVariableById(edit.id, next);
        return workspace.getVariableById(edit.id)?.name === next ? 'applied' : 'conflict';
    }
    if (edit.type === 'procedure') {
        if (!('block' in result)) return 'stale';
        const procedure = result.block.mutation?.proccode ??
            target.blocks.getBlock(result.block.inputs?.custom_block?.block)?.mutation?.proccode;
        if (procedure !== edit.name) return 'stale';
        if (!validName(next) || !next.replace(/%[sbn]/g, '').trim()) return 'invalid';
        const prototype = Blockly.Procedures.getPrototypeBlock(edit.name, workspace);
        if (!prototype) return 'stale';
        if (next !== edit.name && Blockly.Procedures.getPrototypeBlock(next, workspace)) return 'conflict';
        const mutation = prototype.mutationToDom();
        mutation.setAttribute('proccode', next);
        Blockly.Procedures.mutateCallersAndPrototype(edit.name, workspace, mutation);
        return 'applied';
    }
    if (edit.type === 'field' && 'block' in result) {
        const {id, field: name, value} = edit;
        if (id !== result.block.id && !Object.values(result.block.inputs ?? {}).some(input => input.block === id)) return 'stale';
        const block = workspace.getBlockById(id);
        const field = block?.getField(name);
        if (!field || String(field.getValue()) !== value || String(target.blocks.getBlock(id)?.fields?.[name]?.value) !== value) return 'stale';
        const text = Boolean(field instanceof Blockly.FieldTextInput);
        const dropdown = Boolean(field instanceof Blockly.FieldDropdown);
        if (!block?.isEditable() || !(text || dropdown)) return 'read-only';
        if (field instanceof Blockly.FieldNumber && (!next.trim() || !Number.isFinite(Number(next)))) return 'invalid';
        if (dropdown && !field.getOptions?.().some(option => String(option[1]) === next)) return 'invalid';
        const validated = field.callValidator(next);
        if (validated === null || (validated !== undefined && String(validated) !== next)) return 'invalid';
        field.setValue(next);
        return String(field.getValue()) === next ? 'applied' : 'invalid';
    }
    return 'read-only';
}
