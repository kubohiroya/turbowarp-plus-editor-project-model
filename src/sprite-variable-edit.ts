export type SpriteVariableEdit =
    {type: 'create'; name: string; isCloud?: boolean} |
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
    {type: 'var_create'; varId: string; varName: string; varType: ''; isLocal: boolean; isCloud: boolean} |
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
            fields: Record<string, {id: string; name: string; value: string; variableType: ''}>;
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
    if (!owner?.isOriginal || variable?.type !== '' ||
        Boolean(runtime.getMonitorState().get(id)?.visible) === visible) return;
    const {monitorBlocks} = runtime;
    let block = monitorBlocks.getBlock(id);
    if (!block) {
        monitorBlocks.createBlock({
            id, opcode: 'data_variable', targetId: owner.isStage ? null : owner.id, inputs: {},
            fields: {VARIABLE: {id, name: 'VARIABLE', value: variable.name, variableType: ''}},
            next: null, parent: null, topLevel: true, shadow: false, x: 0, y: 0
        });
        block = monitorBlocks.getBlock(id);
    }
    if (block?.opcode !== 'data_variable') return;
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
        const cloud = edit.type === 'create' ? edit.isCloud === true : variable?.isCloud === true;
        const name = (cloud && edit.name.startsWith(cloudVariablePrefix) ?
            edit.name.slice(cloudVariablePrefix.length) : edit.name).trim();
        if (!name) return 'emptyName';
        const fullName = cloud ? cloudVariablePrefix + name : name;
        if (fullName === variable?.name) return;
        const scope = target.isStage ? runtime.targets.filter(item => item.isStage || item.isOriginal) :
            [target, runtime.getTargetForStage()];
        if (scope.some(owner => owner && Object.values(owner.variables).some(item => item.type === '' && item.name === fullName))) {
            return 'duplicateName';
        }
        if (edit.type === 'create') {
            if (cloud && !target.isStage) return 'unavailable';
            if (cloud && !runtime.canAddCloudVariable?.()) return 'cloudLimit';
            const varId = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');
            target.blocks.blocklyListen({type: 'var_create', varId, varName: fullName, varType: '', isLocal: !target.isStage, isCloud: cloud});
        } else {
            target.blocks.blocklyListen({type: 'var_rename', varId: edit.id, newName: fullName});
        }
    }
    vm.refreshWorkspace();
}
