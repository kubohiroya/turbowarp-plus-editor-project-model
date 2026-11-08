export type SpriteVariableEdit =
    {type: 'create'; name: string} |
    {type: 'rename'; id: string; name: string} |
    {type: 'delete'; id: string};

export type SpriteVariableEditError = 'emptyName' | 'duplicateName' | 'inUse' | 'unavailable';

type Variable = {name: string; type: string; isCloud?: boolean};
type Block = {
    opcode: string;
    fields: Record<string, {value: unknown}>;
    inputs: Record<string, {block: string | null; shadow: string | null}>;
};
type VariableEvent =
    {type: 'var_create'; varId: string; varName: string; varType: ''; isLocal: boolean; isCloud: false} |
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
    };
    refreshWorkspace(): void;
};

export const cloudVariablePrefix = '☁ ';

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
        const name = edit.name.trim();
        if (!name) return 'emptyName';
        const fullName = variable?.isCloud && !name.startsWith(cloudVariablePrefix) ? cloudVariablePrefix + name : name;
        if (fullName === variable?.name) return;
        const scope = target.isStage ? runtime.targets.filter(item => item.isStage || item.isOriginal) :
            [target, runtime.getTargetForStage()];
        if (scope.some(owner => owner && Object.values(owner.variables).some(item => item.type === '' && item.name === fullName))) {
            return 'duplicateName';
        }
        if (edit.type === 'create') {
            const varId = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');
            target.blocks.blocklyListen({type: 'var_create', varId, varName: fullName, varType: '', isLocal: !target.isStage, isCloud: false});
        } else {
            target.blocks.blocklyListen({type: 'var_rename', varId: edit.id, newName: fullName});
        }
    }
    vm.refreshWorkspace();
}
