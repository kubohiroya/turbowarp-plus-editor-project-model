type VariableType = '' | 'list';

export type SpriteVariableEdit =
    {type: 'create'; name: string; variableType?: ''; isCloud?: boolean} |
    {type: 'create'; name: string; variableType: 'list'; isCloud?: false} |
    {type: 'rename'; id: string; name: string} |
    {type: 'delete'; id: string};

export type SpriteVariableEditError = 'emptyName' | 'duplicateName' | 'inUse' | 'unavailable' | 'cloudLimit';

type Variable = {name: string; type: string; isCloud?: boolean};
type Block = {
    opcode: string;
    fields: Record<string, {value: unknown}>;
    inputs: Record<string, {block: string | null; shadow: string | null}>;
};
type VariableEvent =
    {type: 'var_create'; varId: string; varName: string; varType: VariableType; isLocal: boolean; isCloud: boolean} |
    {type: 'var_rename'; varId: string; newName: string} |
    {type: 'var_delete'; varId: string};
type VariableTarget = {
    id: string;
    isStage: boolean;
    isOriginal: boolean;
    getName(): string;
    variables: Record<string, Variable>;
    blocks: {
        _blocks: Record<string, Block>;
        getAllVariableAndListReferences(): Record<string, unknown>;
        blocklyListen(event: VariableEvent): void;
    };
};
type VariableProject = {
    editingTarget?: VariableTarget;
    runtime: {
        targets: readonly VariableTarget[];
        getEditingTarget(): VariableTarget | null;
        getTargetForStage(): VariableTarget | null;
        canAddCloudVariable?(): boolean;
    };
    refreshWorkspace(): void;
};

export type SpriteListItem = string | number | boolean;
export type SpriteVariableValue = string | number | readonly SpriteListItem[];

type VariableValue = {id: string; name: string; type: string; value: unknown; isCloud?: boolean; _monitorUpToDate?: boolean};

export function readSpriteVariable(variable: VariableValue) {
    const {id, name, type, value, isCloud} = variable;
    if (type === 'list' && Array.isArray(value)) return {id, name, value: value as readonly SpriteListItem[]};
    if (type === '' && (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean')) {
        return {id, name, value: typeof value === 'boolean' ? String(value) : value, isCloud};
    }
}

export function writeSpriteVariableValue(vm: {
    runtime: {getTargetById(id: string): {variables: Record<string, VariableValue>} | undefined};
    setVariableValue(targetId: string, variableId: string, value: SpriteVariableValue): boolean;
}, targetId: string, id: string, value: SpriteVariableValue) {
    const variable = vm.runtime.getTargetById(targetId)?.variables[id];
    const list = typeof value === 'object';
    if (!variable || variable.type !== (list ? 'list' : '') || !vm.setVariableValue(targetId, id, value)) return false;
    if (list) variable._monitorUpToDate = false;
    return true;
}

export const cloudVariablePrefix = '☁ ';

type VariableMonitorBlock = {
    id: string;
    opcode: string;
    isMonitored?: boolean;
    targetId: string | null;
};

type VariableMonitorRuntime = {
    getTargetById(id: string): VariableTarget | undefined;
    getMonitorState(): {get(id: string): {visible: boolean} | undefined};
    monitorBlocks: {
        getBlock(id: string): VariableMonitorBlock | undefined;
        createBlock(block: VariableMonitorBlock & {
            fields: Record<string, {id: string; name: string; value: string; variableType: '' | 'list'}>;
            inputs: Record<string, never>;
            next: null;
            parent: null;
            topLevel: true;
            shadow: false;
            x: number;
            y: number;
        }): void;
        changeBlock(change: {id: string; element: 'checkbox'; value: boolean}): void;
    };
    emitProjectChanged(): void;
};

export function showSpriteVariableOnStage(runtime: VariableMonitorRuntime, targetId: string, id: string, visible: boolean) {
    const owner = runtime.getTargetById(targetId);
    const variable = owner?.variables[id];
    if (!owner?.isOriginal || !variable || !['', 'list'].includes(variable.type) ||
        Boolean(runtime.getMonitorState().get(id)?.visible) === visible) return;
    const list = variable.type === 'list';
    const opcode = list ? 'data_listcontents' : 'data_variable';
    const field = list ? 'LIST' : 'VARIABLE';
    const {monitorBlocks} = runtime;
    let block = monitorBlocks.getBlock(id);
    if (!block) {
        monitorBlocks.createBlock({
            id, opcode, targetId: owner.isStage ? null : owner.id, inputs: {},
            fields: {[field]: {id, name: field, value: variable.name, variableType: list ? 'list' : ''}},
            next: null, parent: null, topLevel: true, shadow: false, x: 0, y: 0
        });
        block = monitorBlocks.getBlock(id);
    }
    if (block?.opcode !== opcode) return;
    block.isMonitored = !visible;
    monitorBlocks.changeBlock({id, element: 'checkbox', value: visible});
    runtime.emitProjectChanged();
}

function isUsed(target: VariableTarget, targets: readonly VariableTarget[], id: string, name: string) {
    const targetName = target.isStage ? '_stage_' : target.getName();
    return targets.some(({blocks}) => {
        if (Object.hasOwn(blocks.getAllVariableAndListReferences(), id)) return true;
        return Object.values(blocks._blocks).some(block => {
            if (block.opcode !== 'sensing_of' || block.fields.PROPERTY?.value !== name) return false;
            const input = block.inputs.OBJECT;
            if (!input?.block) return false;
            // A dynamic target can resolve to the variable's owner when the project runs.
            return input.block !== input.shadow || blocks._blocks[input.block]?.fields.OBJECT?.value === targetName;
        });
    });
}

export function editSpriteVariable(vm: VariableProject, targetId: string, edit: SpriteVariableEdit): SpriteVariableEditError | void {
    const target = vm.editingTarget;
    const {runtime} = vm;
    if (!target || target.id !== targetId || runtime.getEditingTarget() !== target ||
        !runtime.targets.includes(target) || (!target.isStage && !target.isOriginal)) return 'unavailable';

    const variable = edit.type === 'create' ? undefined : target.variables[edit.id];
    if (edit.type !== 'create' && variable?.type !== '') return 'unavailable';
    if (edit.type === 'delete') {
        if (isUsed(target, runtime.targets, edit.id, variable!.name)) return 'inUse';
        target.blocks.blocklyListen({type: 'var_delete', varId: edit.id});
    } else {
        const variableType = edit.type === 'create' ? edit.variableType ?? '' : '';
        const cloud = edit.type === 'create' ? variableType === '' && edit.isCloud === true : variable?.isCloud === true;
        const name = (cloud && edit.name.startsWith(cloudVariablePrefix) ?
            edit.name.slice(cloudVariablePrefix.length) : edit.name).trim();
        if (!name) return 'emptyName';
        const fullName = cloud ? cloudVariablePrefix + name : name;
        if (fullName === variable?.name) return;
        const scope = target.isStage ? runtime.targets.filter(item => item.isStage || item.isOriginal) :
            [target, runtime.getTargetForStage()];
        if (scope.some(owner => owner && Object.values(owner.variables).some(item =>
            item.type === variableType && item.name === fullName))) {
            return 'duplicateName';
        }
        if (edit.type === 'create') {
            if (cloud && !target.isStage) return 'unavailable';
            if (cloud && !runtime.canAddCloudVariable?.()) return 'cloudLimit';
            const varId = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');
            target.blocks.blocklyListen({
                type: 'var_create', varId, varName: fullName, varType: variableType, isLocal: !target.isStage, isCloud: cloud
            });
        } else {
            target.blocks.blocklyListen({type: 'var_rename', varId: edit.id, newName: fullName});
        }
    }
    vm.refreshWorkspace();
}
