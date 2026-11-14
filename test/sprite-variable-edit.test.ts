import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cloudVariablePrefix, editSpriteVariable} from '../dist/sprite-variable-edit.js';

type Variable = {name: string; type: string; isCloud?: boolean};
type Block = {
    opcode: string;
    fields: Record<string, {value: unknown}>;
    inputs: Record<string, {block: string | null; shadow: string | null}>;
};

function makeTarget(id: string, {isStage = false, isOriginal = true, name = id, variables = {} as Record<string, Variable>,
    blocks = {} as Record<string, Block>, references = {} as Record<string, unknown>} = {}) {
    const events: unknown[] = [];
    return {
        id, isStage, isOriginal, variables, events,
        getName: () => name,
        blocks: {
            _blocks: blocks,
            getAllVariableAndListReferences: () => references,
            blocklyListen(event: unknown) {events.push(event);}
        }
    };
}

function makeProject(editing: ReturnType<typeof makeTarget>, others: ReturnType<typeof makeTarget>[] = []) {
    const targets = [editing, ...others];
    let refreshed = 0;
    const vm = {
        editingTarget: editing,
        runtime: {
            targets,
            getEditingTarget: () => editing,
            getTargetForStage: () => targets.find(target => target.isStage) ?? null
        },
        refreshWorkspace() {refreshed++;}
    };
    return {vm, refreshed: () => refreshed};
}

test('creates a trimmed variable and refreshes the workspace', () => {
    const sprite = makeTarget('sprite');
    const {vm, refreshed} = makeProject(sprite);
    assert.equal(editSpriteVariable(vm, 'sprite', {type: 'create', name: '  score  '}), undefined);
    assert.equal(sprite.events.length, 1);
    assert.deepEqual({...sprite.events[0] as object, varId: 'id'},
        {type: 'var_create', varId: 'id', varName: 'score', varType: '', isLocal: true, isCloud: false});
    assert.equal(refreshed(), 1);
});

test('rejects empty and duplicate names against the sprite and the stage', () => {
    const stage = makeTarget('stage', {isStage: true, variables: {g: {name: 'global', type: ''}}});
    const sprite = makeTarget('sprite', {variables: {l: {name: 'local', type: ''}}});
    const {vm, refreshed} = makeProject(sprite, [stage]);
    assert.equal(editSpriteVariable(vm, 'sprite', {type: 'create', name: '   '}), 'emptyName');
    assert.equal(editSpriteVariable(vm, 'sprite', {type: 'create', name: 'local'}), 'duplicateName');
    assert.equal(editSpriteVariable(vm, 'sprite', {type: 'create', name: 'global'}), 'duplicateName');
    assert.equal(sprite.events.length, 0);
    assert.equal(refreshed(), 0);
});

test('keeps the cloud prefix when renaming a cloud variable', () => {
    const stage = makeTarget('stage', {isStage: true, variables: {c: {name: `${cloudVariablePrefix}hi`, type: '', isCloud: true}}});
    const {vm} = makeProject(stage);
    assert.equal(editSpriteVariable(vm, 'stage', {type: 'rename', id: 'c', name: 'best'}), undefined);
    assert.deepEqual(stage.events, [{type: 'var_rename', varId: 'c', newName: `${cloudVariablePrefix}best`}]);
});

test('creates cloud variables through the stage event only while capacity is available', () => {
    const stage = makeTarget('stage', {isStage: true});
    const {vm, refreshed} = makeProject(stage);
    const edit = {type: 'create', name: ' スコア ', isCloud: true} as const;
    assert.equal(editSpriteVariable(vm, 'stage', edit), 'cloudLimit');
    assert.equal(refreshed(), 0);
    assert.equal(stage.events.length, 0);
    const available = {...vm, runtime: {...vm.runtime, canAddCloudVariable: () => true}};
    assert.equal(editSpriteVariable(available, 'stage', edit), undefined);
    assert.deepEqual({...stage.events[0] as object, varId: 'id'},
        {type: 'var_create', varId: 'id', varName: '☁ スコア', varType: '', isLocal: false, isCloud: true});
    assert.equal(refreshed(), 1);
    const sprite = makeTarget('sprite');
    assert.equal(editSpriteVariable(makeProject(sprite, [stage]).vm, 'sprite', edit), 'unavailable');
});

test('refuses to delete a variable that a block or a sensing_of block uses', () => {
    const used = makeTarget('sprite', {name: 'Cat', variables: {v: {name: 'speed', type: ''}}, references: {v: []}});
    assert.equal(editSpriteVariable(makeProject(used).vm, 'sprite', {type: 'delete', id: 'v'}), 'inUse');

    const sprite = makeTarget('sprite', {name: 'Cat', variables: {v: {name: 'speed', type: ''}}});
    const reader = makeTarget('reader', {blocks: {
        of: {opcode: 'sensing_of', fields: {PROPERTY: {value: 'speed'}}, inputs: {OBJECT: {block: 'menu', shadow: 'menu'}}},
        menu: {opcode: 'sensing_of_object_menu', fields: {OBJECT: {value: 'Cat'}}, inputs: {}}
    }});
    assert.equal(editSpriteVariable(makeProject(sprite, [reader]).vm, 'sprite', {type: 'delete', id: 'v'}), 'inUse');

    const free = makeTarget('sprite', {variables: {v: {name: 'speed', type: ''}}});
    assert.equal(editSpriteVariable(makeProject(free).vm, 'sprite', {type: 'delete', id: 'v'}), undefined);
    assert.deepEqual(free.events, [{type: 'var_delete', varId: 'v'}]);
});

test('is unavailable for a clone, another target, or a list', () => {
    const clone = makeTarget('clone', {isOriginal: false});
    assert.equal(editSpriteVariable(makeProject(clone).vm, 'clone', {type: 'create', name: 'x'}), 'unavailable');

    const sprite = makeTarget('sprite', {variables: {l: {name: 'items', type: 'list'}}});
    const {vm} = makeProject(sprite);
    assert.equal(editSpriteVariable(vm, 'other', {type: 'create', name: 'x'}), 'unavailable');
    assert.equal(editSpriteVariable(vm, 'sprite', {type: 'rename', id: 'l', name: 'x'}), 'unavailable');
});
