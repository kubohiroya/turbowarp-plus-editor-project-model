import assert from 'node:assert/strict';
import {test} from 'node:test';
import {countVariableAccesses, searchProject, searchYamlDocuments, type SearchKind,
    type SearchProject, type VariableAccess} from '../dist/project-search.js';
import {applyProjectSearchReplacement, renameProjectMessage, replacementText, type ReplaceBlockly, type ReplaceWorkspace} from '../dist/project-search-replace.js';

type Target = SearchProject['targets'][number];
type Block = ReturnType<Target['blocks']['getBlock']>;

function target(id: string, scripts: string[], blocks: Block[], options: Partial<Target> = {}): Target {
    return {
        id, isOriginal: true, isStage: false, getName: () => id, variables: {},
        getCostumes: () => [], getSounds: () => [],
        blocks: {
            getScripts: () => scripts,
            getBlock: blockId => blocks.find(block => block.id === blockId)
        },
        ...options
    };
}

test('project search groups nested blocks, asset names and variable uses from original targets', () => {
    const stage = target('stage', ['receive'], [
        {id: 'receive', opcode: 'event_whenbroadcastreceived', fields: {BROADCAST_OPTION: {value: '開始'}}}
    ], {isStage: true, variables: {global: {name: '速度'}}, getCostumes: () => [{name: '開始画面'}]});
    const first = target('first', ['repeat'], [
        {id: 'repeat', opcode: 'control_repeat', inputs: {SUBSTACK: {block: 'move'}}},
        {id: 'move', opcode: 'motion_movesteps', next: 'increment', inputs: {STEPS: {block: 'distance'}}},
        {id: 'distance', opcode: 'math_number', shadow: true, fields: {NUM: {value: 10}}},
        {id: 'increment', opcode: 'data_changevariableby', fields: {VARIABLE: {id: 'global', value: 'old name'}}}
    ]);
    const second = target('second', ['show', 'send'], [
        {id: 'show', opcode: 'data_showvariable', fields: {VARIABLE: {id: 'local', value: '速度'}}},
        {id: 'send', opcode: 'event_broadcast', inputs: {BROADCAST_INPUT: {block: 'menu'}}},
        {id: 'menu', opcode: 'event_broadcast_menu', shadow: true, fields: {BROADCAST_OPTION: {value: '開始'}}}
    ], {variables: {local: {name: '速度'}}, getSounds: () => [{name: '開始音'}]});
    const clone = {...second, id: 'clone', isOriginal: false};
    const project = {targets: [stage, first, second, clone]};
    const messages = {MOTION_MOVESTEPS: '%1 歩動かす'};
    const search = (query: string) => searchProject(project, messages, query, true);

    const blocks = search('歩動かす');
    assert.deepEqual(blocks.map(group => group.kind), ['block']);
    assert.equal(blocks[0].results[0].label, '10 歩動かす');
    assert.deepEqual(search('速度')[0].results.map(result => [result.target.id, result.detail]),
        [['first', '全体'], ['second', 'このスプライト']]);
    assert.deepEqual(search('開始').map(group => [group.kind, group.results.map(result => result.target.id)]),
        [['message', ['stage', 'second']], ['backdrop', ['stage']], ['sound', ['second']]]);
    assert.deepEqual(search('math_number'), []);
});

test('filters separate block names, arguments, extension names and comments', () => {
    const sprite = target('sprite', ['speak'], [
        {id: 'speak', opcode: 'talk_speak', inputs: {TEXT: {block: 'text'}}},
        {id: 'text', opcode: 'text', shadow: true, fields: {TEXT: {value: '合図を出す'}}}
    ], {comments: {comment: {text: '合図を確認', blockId: 'speak'}}});
    const project = {
        targets: [sprite],
        getLabelForOpcode: () => ({category: 'extension', label: '合図ツール: 合図を話す [TEXT]'})
    };
    const search = (...kinds: SearchKind[]) => searchProject(project, {}, '合図', true, new Set(kinds));
    assert.deepEqual(search('block', 'argument', 'extension', 'comment').map(group => group.kind),
        ['block', 'argument', 'extension', 'comment']);
    assert.deepEqual(search('argument').flatMap(group => group.results.map(result => result.label)), ['合図を出す']);
    assert.deepEqual(search('extension').flatMap(group => group.results.map(result => result.label)), ['合図ツール']);
    assert.deepEqual(search('comment').flatMap(group => group.results.map(result => result.label)), ['合図を確認']);
    assert.deepEqual(searchProject(project, {}, '出す', true, new Set(['block'])), []);
    assert.deepEqual(searchProject(project, {}, 'ツール', true, new Set(['block'])), []);
});

test('variable access counts and exact search agree across targets and nested blocks', () => {
    const stage = target('stage', [], [], {isStage: true, variables: {global: {name: '点', type: ''}}});
    const reference = (id: string, opcode: string, variableId: string): Block => ({
        id, opcode, fields: {VARIABLE: {id: variableId, value: '点'}}
    });
    const sprite = target('sprite', ['set', 'show', 'attribute', 'dynamic'], [
        {...reference('set', 'data_setvariableto', 'global'), next: 'change', inputs: {VALUE: {block: 'read-local'}}},
        {...reference('change', 'data_changevariableby', 'global'), inputs: {VALUE: {block: 'read-global'}}},
        reference('read-local', 'data_variable', 'local'),
        reference('read-global', 'data_variable', 'global'),
        reference('show', 'data_showvariable', 'global'),
        {id: 'attribute', opcode: 'sensing_of', fields: {PROPERTY: {value: '点'}}, inputs: {OBJECT: {block: 'stage-menu'}}},
        {id: 'stage-menu', opcode: 'sensing_of_object_menu', shadow: true, fields: {OBJECT: {value: '_stage_'}}},
        {id: 'dynamic', opcode: 'sensing_of', fields: {PROPERTY: {value: '点'}}, inputs: {OBJECT: {block: 'read-local'}}}
    ], {variables: {local: {name: '点', type: ''}}});
    const project = {targets: [stage, sprite, {...sprite, id: 'clone', isOriginal: false}]};
    const search = (ownerId: string, variableId: string, access: VariableAccess) =>
        searchProject(project, {}, '', true, new Set(), {ownerId, variableId, access})
            .flatMap(group => group.results.map(result => 'block' in result && [result.block.id, result.variableAccess]));

    assert.deepEqual([...countVariableAccesses(project, 'stage')], [['global', {read: 2, write: 2}]]);
    assert.deepEqual([...countVariableAccesses(project, 'sprite')], [['local', {read: 1, write: 0}]]);
    assert.deepEqual(search('stage', 'global', 'read'), [['read-global', 'read'], ['attribute', 'read']]);
    assert.deepEqual(search('stage', 'global', 'write'), [['set', 'write'], ['change', 'write']]);
    assert.deepEqual(search('sprite', 'local', 'read'), [['read-local', 'read']]);
    assert.deepEqual(search('sprite', 'global', 'read'), []);
});

test('YAML results preserve document identity and UTF-16 offsets for each literal match', () => {
    const documents = ['a', 'b'].map(documentId => ({
        reference: {providerId: 'provider', documentId},
        filename: 'settings.yaml',
        source: 'key: 📚開始. 開始.\nother: 開始.'
    }));
    const results = searchYamlDocuments(documents, '開始.', true);
    assert.deepEqual(results.map(result => result.document.reference.documentId), ['a', 'a', 'a', 'b', 'b', 'b']);
    assert.deepEqual(results.slice(0, 3).map(result => result.detail),
        ['1 行 8 列 · provider/a', '1 行 12 列 · provider/a', '2 行 8 列 · provider/a']);
    for (const {document, range: {start, end, expectedText}} of results) {
        assert.equal(document.source.slice(start, end), expectedText);
        assert.equal(expectedText, '開始.');
    }
});

test('replacement splices a literal match and rejects a renamed or conflicting variable', () => {
    const field = {id: 'score', value: 'old.score'};
    const stage = target('stage', ['use'], [{id: 'use', opcode: 'data_showvariable', fields: {VARIABLE: field}}],
        {isStage: true, variables: {score: {name: 'old.score'}, conflict: {name: 'new.score'}}});
    const project = {targets: [stage]};
    const result = searchProject(project, {}, 'old.', false, new Set(['variable']))[0].results[0];
    assert.equal(replacementText(result, 'old.', '$1.'), '$1.score');
    assert.equal(replacementText(result, 'old.', 'old.'), undefined);

    const workspace = {
        options: {readOnly: false}, isDragging: () => false, getVariableById: () => stage.variables.score,
        renameVariableById: () => assert.fail('The result must be refused before editing the workspace')
    } as unknown as ReplaceWorkspace;
    const Blockly = {} as ReplaceBlockly;
    assert.equal(applyProjectSearchReplacement(project, workspace, Blockly, result, 'new.score'), 'conflict');
    field.id = 'conflict';
    assert.equal(applyProjectSearchReplacement(project, workspace, Blockly, result, 'other.score'), 'stale');
});

test('renaming a message from the message section keeps the block references and refuses a taken name', () => {
    const option = {id: 'go', value: '開始'};
    const stage = target('stage', ['receive'], [
        {id: 'receive', opcode: 'event_whenbroadcastreceived', fields: {BROADCAST_OPTION: option}}
    ], {isStage: true, variables: {
        go: {name: '開始', type: 'broadcast_msg', value: '開始'},
        done: {name: '完了', type: 'broadcast_msg', value: '完了'},
        score: {name: '点', type: ''}
    }});
    let changed;
    const project = {
        targets: [stage],
        resetAllCaches: () => undefined,
        emitProjectChanged: () => undefined
    } as unknown as SearchProject;
    const workspace = {
        options: {readOnly: false},
        isDragging: () => false,
        getVariableById: (id: string) => stage.variables[id],
        renameVariableById(id: string, name: string) {
            stage.variables[id].name = name;
            changed?.({type: 'var_rename', varId: id, newName: name});
        },
        addChangeListener(listener: (event: {type: string; varId?: string; newName?: string}) => void) {
            changed = listener;
        }
    } as unknown as ReplaceWorkspace;

    assert.equal(renameProjectMessage(project, workspace, 'go', '完了'), 'conflict');
    assert.equal(renameProjectMessage(project, workspace, 'go', '  '), 'invalid');
    assert.equal(renameProjectMessage(project, workspace, 'score', '合図'), 'stale');
    assert.equal(renameProjectMessage(project, workspace, 'go', '合図'), 'applied');
    assert.equal(stage.variables.go.name, '合図');
    // The references a renamed message leaves in the blocks are brought along.
    assert.equal(option.value, '合図');
    assert.deepEqual(searchProject(project, {}, '合図', true, new Set(['message']))
        .flatMap(group => group.results.map(result => result.label)), ['合図']);
});
