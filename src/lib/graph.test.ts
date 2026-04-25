import { describe, expect, it } from 'bun:test';

import { buildGraph } from './graph';
import type {
  BindingState,
  Instance,
  Message,
  PtySession,
  Task,
} from './types';

function makeInstance(id: string, scope = 'scope-a'): Instance {
  return {
    id,
    scope,
    directory: '/tmp',
    root: '/tmp',
    file_root: '/tmp',
    pid: 1,
    label: null,
    registered_at: 0,
    heartbeat: 0,
    status: 'online',
    adopted: true,
  };
}

function makePty(id: string, boundInstanceId: string | null = null): PtySession {
  return {
    id,
    command: 'shell',
    cwd: '/tmp',
    started_at: 0,
    exit_code: null,
    bound_instance_id: boundInstanceId,
    launch_token: null,
    cols: 120,
    rows: 40,
    lease: null,
  };
}

describe('buildGraph', () => {
  it('only renders bound nodes when both the scoped instance and PTY exist', () => {
    const ptySessions = new Map([['pty-1', makePty('pty-1', 'other-scope-agent')]]);
    const bindings: BindingState = {
      pending: [],
      resolved: [['other-scope-agent', 'pty-1']],
    };

    const graph = buildGraph(
      new Map(),
      ptySessions,
      new Map<string, Task>(),
      [] as Message[],
      [],
      bindings,
    );

    expect(graph.nodes.map((node) => node.id)).toEqual([]);
  });

  it('does not hide an instance when a stale binding points at a missing PTY', () => {
    const instances = new Map([['agent-1', makeInstance('agent-1')]]);
    const bindings: BindingState = {
      pending: [],
      resolved: [['agent-1', 'missing-pty']],
    };

    const graph = buildGraph(
      instances,
      new Map(),
      new Map<string, Task>(),
      [] as Message[],
      [],
      bindings,
    );

    expect(graph.nodes.map((node) => node.id)).toEqual(['instance:agent-1']);
  });

  it('renders a bound node for a valid scoped instance and PTY pair', () => {
    const instances = new Map([['agent-1', makeInstance('agent-1')]]);
    const ptySessions = new Map([['pty-1', makePty('pty-1', 'agent-1')]]);
    const bindings: BindingState = {
      pending: [],
      resolved: [['agent-1', 'pty-1']],
    };

    const graph = buildGraph(
      instances,
      ptySessions,
      new Map<string, Task>(),
      [] as Message[],
      [],
      bindings,
    );

    expect(graph.nodes.map((node) => node.id)).toEqual(['bound:agent-1']);
    expect(graph.nodes[0]?.data.instance?.id).toBe('agent-1');
    expect(graph.nodes[0]?.data.ptySession?.id).toBe('pty-1');
  });
});
