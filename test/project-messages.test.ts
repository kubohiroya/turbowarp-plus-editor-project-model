import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    checkMessageRename, messageReference, projectMessageGraph, scanProjectMessages, scanTargetMessages
} from '../dist/project-messages.js';

type RawBlock = {
    opcode: string;
    next?: string | null;
    shadow?: boolean;
    fields?: Record<string, {id?: string; value?: unknown}>;
    inputs?: Record<string, {block?: string | null; shadow?: string | null}>;
};

function makeTarget({id, name, isStage = false, isOriginal = true, variables = {}, blocks = {}}: {
    id: string;
    name: string;
    isStage?: boolean;
    isOriginal?: boolean;
    variables?: Record<string, {name: string; type?: string}>;
    blocks?: Record<string, RawBlock>;
}) {
    const withIds = Object.fromEntries(Object.entries(blocks).map(([key, block]) => [key, {...block, id: key}]));
    const referenced = new Set<string>();
    for (const block of Object.values(withIds)) {
        if (block.next) referenced.add(block.next);
        for (const input of Object.values(block.inputs ?? {})) {
            if (input.block) referenced.add(input.block);
            if (input.shadow) referenced.add(input.shadow);
        }
    }
    return {
        id,
        isStage,
        isOriginal,
        getName: () => name,
        variables,
        blocks: {
            getScripts: () => Object.keys(withIds).filter(key => !referenced.has(key) && !withIds[key].shadow),
            getBlock: (blockId: string) => withIds[blockId]
        }
    };
}

/** A send block names its message through a shadow menu; a hat names it in its own field. */
const send = (menuId: string, next?: string, wait = false) => ({
    opcode: wait ? 'event_broadcastandwait' : 'event_broadcast',
    next: next ?? null,
    inputs: {BROADCAST_INPUT: {block: menuId, shadow: menuId}}
});
const menu = (id: string, name: string) => ({
    opcode: 'event_broadcast_menu',
    shadow: true,
    fields: {BROADCAST_OPTION: {id, value: name}}
});
const hat = (id: string, name: string, next?: string) => ({
    opcode: 'event_whenbroadcastreceived',
    next: next ?? null,
    fields: {BROADCAST_OPTION: {id, value: name}}
});

function makeProject() {
    const stage = makeTarget({
        id: 'stage',
        name: 'Stage',
        isStage: true,
        variables: {
            go: {name: 'go', type: 'broadcast_msg'},
            done: {name: 'done', type: 'broadcast_msg'},
            idle: {name: 'idle', type: 'broadcast_msg'},
            score: {name: 'score', type: ''}
        },
        blocks: {
            'stage-hat': hat('done', 'done')
        }
    });
    const cat = makeTarget({
        id: 'cat',
        name: 'Cat',
        blocks: {
            flag: {opcode: 'event_whenflagclicked', next: 'cat-send'},
            'cat-send': send('cat-menu'),
            'cat-menu': menu('go', 'go'),
            'cat-receive': hat('go', 'go', 'cat-wait'),
            'cat-wait': send('cat-wait-menu', null, true),
            'cat-wait-menu': menu('done', 'done')
        }
    });
    const dog = makeTarget({
        id: 'dog',
        name: 'Dog',
        blocks: {
            'dog-receive': hat('go', 'go')
        }
    });
    const clone = makeTarget({
        id: 'dog-clone',
        name: 'Dog',
        isOriginal: false,
        blocks: {'clone-receive': hat('go', 'go')}
    });
    return {targets: [stage, cat, dog, clone]};
}

test('a broadcast block names its message through its field or its shadow menu', () => {
    const project = makeProject();
    const [stage, cat] = project.targets;
    assert.deepEqual(messageReference(cat, cat.blocks.getBlock('cat-send'), stage), {
        direction: 'send', id: 'go', fieldValue: 'go', name: 'go', wait: false
    });
    assert.deepEqual(messageReference(cat, cat.blocks.getBlock('cat-wait'), stage), {
        direction: 'send', id: 'done', fieldValue: 'done', name: 'done', wait: true
    });
    assert.deepEqual(messageReference(cat, cat.blocks.getBlock('cat-receive'), stage), {
        direction: 'receive', id: 'go', fieldValue: 'go', name: 'go', wait: false
    });
    assert.equal(messageReference(cat, cat.blocks.getBlock('flag'), stage), undefined);
});

test('the stage variable name wins over a stale dropdown value', () => {
    const project = makeProject();
    const [stage, cat] = project.targets;
    stage.variables.go.name = 'start';
    const reference = messageReference(cat, cat.blocks.getBlock('cat-send'), stage);
    assert.equal(reference.name, 'start');
    assert.equal(reference.fieldValue, 'go');
});

test('a message whose block is a reporter has no static reference', () => {
    const target = makeTarget({
        id: 'cat',
        name: 'Cat',
        blocks: {
            dynamic: {opcode: 'event_broadcast', inputs: {BROADCAST_INPUT: {block: 'joined', shadow: 'fallback'}}},
            joined: {opcode: 'operator_join', inputs: {}},
            fallback: menu('go', 'go')
        }
    });
    assert.equal(messageReference(target, target.blocks.getBlock('dynamic')), undefined);
});

test('scanning collects every send and receive and ignores clones', () => {
    const messages = scanProjectMessages(makeProject());
    assert.deepEqual(messages.map(message => [message.name, message.status]),
        [['done', 'both'], ['go', 'both'], ['idle', 'unused']]);

    const go = messages.find(message => message.name === 'go');
    assert.deepEqual(go.sends.map(use => [use.targetId, use.blockId, use.wait]), [['cat', 'cat-send', false]]);
    assert.deepEqual(go.receives.map(use => use.targetId), ['cat', 'dog']);

    const done = messages.find(message => message.name === 'done');
    assert.deepEqual(done.sends.map(use => [use.targetId, use.blockId, use.wait]), [['cat', 'cat-wait', true]]);
    assert.deepEqual(done.receives.map(use => use.targetId), ['stage']);
});

test('a use reports the script it belongs to, naming the hat that starts it', () => {
    const cat = scanTargetMessages(makeProject(), 'cat');
    // "broadcast done and wait" sits under the "when I receive go" hat.
    const wait = cat.sends.find(use => use.blockId === 'cat-wait');
    assert.equal(wait.scriptId, 'cat-receive');
    assert.equal(wait.scriptOpcode, 'event_whenbroadcastreceived');
    assert.equal(wait.scriptMessageName, 'go');

    const plain = cat.sends.find(use => use.blockId === 'cat-send');
    assert.equal(plain.scriptOpcode, 'event_whenflagclicked');
    assert.equal(plain.scriptMessageName, undefined);
});

test('a target sees its own sends and receives, and the messages used elsewhere', () => {
    const cat = scanTargetMessages(makeProject(), 'cat');
    assert.equal(cat.isStage, false);
    assert.deepEqual(cat.sends.map(use => use.blockId).sort(), ['cat-send', 'cat-wait']);
    assert.deepEqual(cat.receives.map(use => use.blockId), ['cat-receive']);
    assert.deepEqual(cat.elsewhere.map(message => message.name), ['idle']);
    assert.equal(cat.graph, undefined);

    const dog = scanTargetMessages(makeProject(), 'dog');
    assert.deepEqual(dog.sends, []);
    assert.deepEqual(dog.elsewhere.map(message => [message.name, message.status]),
        [['done', 'both'], ['idle', 'unused']]);
});

test('the stage carries the project diagram, keeping isolated messages', () => {
    const stage = scanTargetMessages(makeProject(), 'stage');
    assert.equal(stage.isStage, true);
    const {graph} = stage;
    assert.deepEqual(graph.targets.map(target => target.id), ['stage', 'cat', 'dog']);
    assert.deepEqual(graph.messages.map(message => message.name), ['done', 'go', 'idle']);

    const goKey = graph.messages.find(message => message.name === 'go').key;
    const doneKey = graph.messages.find(message => message.name === 'done').key;
    const idleKey = graph.messages.find(message => message.name === 'idle').key;
    assert.deepEqual(graph.edges.filter(edge => edge.messageKey === goKey), [
        {direction: 'send', targetId: 'cat', messageKey: goKey, count: 1},
        {direction: 'receive', targetId: 'cat', messageKey: goKey, count: 1},
        {direction: 'receive', targetId: 'dog', messageKey: goKey, count: 1}
    ]);
    assert.deepEqual(graph.edges.filter(edge => edge.messageKey === doneKey), [
        {direction: 'send', targetId: 'cat', messageKey: doneKey, count: 1},
        {direction: 'receive', targetId: 'stage', messageKey: doneKey, count: 1}
    ]);
    assert.deepEqual(graph.edges.filter(edge => edge.messageKey === idleKey), []);
});

test('a message with no receiver and one with no sender are told apart', () => {
    const stage = makeTarget({id: 'stage', name: 'Stage', isStage: true, variables: {
        shout: {name: 'shout', type: 'broadcast_msg'},
        listen: {name: 'listen', type: 'broadcast_msg'}
    }});
    const cat = makeTarget({id: 'cat', name: 'Cat', blocks: {
        send: send('menu'),
        menu: menu('shout', 'shout'),
        hat: hat('listen', 'listen')
    }});
    const messages = scanProjectMessages({targets: [stage, cat]});
    assert.deepEqual(messages.map(message => [message.name, message.status]),
        [['listen', 'receiveOnly'], ['shout', 'sendOnly']]);
});

test('several blocks sending the same message count on one edge', () => {
    const stage = makeTarget({id: 'stage', name: 'Stage', isStage: true,
        variables: {go: {name: 'go', type: 'broadcast_msg'}}});
    const cat = makeTarget({id: 'cat', name: 'Cat', blocks: {
        first: send('first-menu', 'second'),
        'first-menu': menu('go', 'go'),
        second: send('second-menu'),
        'second-menu': menu('go', 'go')
    }});
    const graph = projectMessageGraph({targets: [stage, cat]});
    assert.deepEqual(graph.edges, [{direction: 'send', targetId: 'cat', messageKey: 'go', count: 2}]);
});

test('a message used without a variable is still grouped by its name', () => {
    const stage = makeTarget({id: 'stage', name: 'Stage', isStage: true});
    const cat = makeTarget({id: 'cat', name: 'Cat', blocks: {
        send: send('menu'),
        menu: {opcode: 'event_broadcast_menu', shadow: true, fields: {BROADCAST_OPTION: {value: 'orphan'}}},
        hat: {opcode: 'event_whenbroadcastreceived', fields: {BROADCAST_OPTION: {value: 'orphan'}}}
    }});
    const messages = scanProjectMessages({targets: [stage, cat]});
    assert.deepEqual(messages.map(message => [message.key, message.name, message.status]),
        [['name:orphan', 'orphan', 'both']]);
});

test('a rename is refused when the name is empty or already taken anywhere in the project', () => {
    const messages = scanProjectMessages(makeProject());
    const go = messages.find(message => message.name === 'go');
    assert.deepEqual(checkMessageRename(messages, go, '   '), {error: 'emptyName'});
    assert.deepEqual(checkMessageRename(messages, go, 'done'), {error: 'duplicateName'});
    assert.deepEqual(checkMessageRename(messages, go, 'IDLE'), {error: 'duplicateName'});
    assert.deepEqual(checkMessageRename(messages, go, 'go'), {unchanged: true});
    assert.deepEqual(checkMessageRename(messages, go, '  start  '), {name: 'start'});
});
