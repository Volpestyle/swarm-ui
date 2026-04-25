import { writable } from 'svelte/store';

export interface AgentWindowSettings {
  defaultWidth: number;
  defaultHeight: number;
  centerOnSpawn: boolean;
}

export const AGENT_WINDOW_WIDTH_MIN = 520;
export const AGENT_WINDOW_WIDTH_MAX = 1400;
export const AGENT_WINDOW_HEIGHT_MIN = 360;
export const AGENT_WINDOW_HEIGHT_MAX = 1000;

const STORAGE_KEY = 'swarm-ui.agent-window';

const DEFAULT_AGENT_WINDOW_SETTINGS: AgentWindowSettings = {
  defaultWidth: 960,
  defaultHeight: 720,
  centerOnSpawn: true,
};

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.round(Math.min(max, Math.max(min, value)));
}

function normalizeAgentWindowSettings(
  value?: Partial<AgentWindowSettings> | null,
): AgentWindowSettings {
  return {
    defaultWidth: clamp(
      value?.defaultWidth ?? DEFAULT_AGENT_WINDOW_SETTINGS.defaultWidth,
      AGENT_WINDOW_WIDTH_MIN,
      AGENT_WINDOW_WIDTH_MAX,
      DEFAULT_AGENT_WINDOW_SETTINGS.defaultWidth,
    ),
    defaultHeight: clamp(
      value?.defaultHeight ?? DEFAULT_AGENT_WINDOW_SETTINGS.defaultHeight,
      AGENT_WINDOW_HEIGHT_MIN,
      AGENT_WINDOW_HEIGHT_MAX,
      DEFAULT_AGENT_WINDOW_SETTINGS.defaultHeight,
    ),
    centerOnSpawn:
      value?.centerOnSpawn ?? DEFAULT_AGENT_WINDOW_SETTINGS.centerOnSpawn,
  };
}

function loadAgentWindowSettings(): AgentWindowSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_AGENT_WINDOW_SETTINGS;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AGENT_WINDOW_SETTINGS;
    return normalizeAgentWindowSettings(JSON.parse(raw) as Partial<AgentWindowSettings>);
  } catch {
    return DEFAULT_AGENT_WINDOW_SETTINGS;
  }
}

function createAgentWindowSettingsStore() {
  const initialValue = loadAgentWindowSettings();
  const { subscribe, set, update } = writable(initialValue);

  if (typeof window !== 'undefined') {
    subscribe((value) => {
      const normalized = normalizeAgentWindowSettings(value);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      } catch {
        // Ignore persistence failures and keep the session-local setting.
      }
    });
  }

  return {
    subscribe,
    setDefaultWidth(value: number) {
      update((current) => normalizeAgentWindowSettings({
        ...current,
        defaultWidth: value,
      }));
    },
    setDefaultHeight(value: number) {
      update((current) => normalizeAgentWindowSettings({
        ...current,
        defaultHeight: value,
      }));
    },
    setCenterOnSpawn(value: boolean) {
      update((current) => normalizeAgentWindowSettings({
        ...current,
        centerOnSpawn: value,
      }));
    },
    reset() {
      set(DEFAULT_AGENT_WINDOW_SETTINGS);
    },
  };
}

export const agentWindowSettings = createAgentWindowSettingsStore();
