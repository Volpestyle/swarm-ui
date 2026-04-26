<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { appearance } from '../stores/appearance';
  import {
    agentWindowSettings,
    AGENT_WINDOW_HEIGHT_MAX,
    AGENT_WINDOW_HEIGHT_MIN,
    AGENT_WINDOW_WIDTH_MAX,
    AGENT_WINDOW_WIDTH_MIN,
  } from '../stores/agentWindowSettings';
  import {
    harnessAliases,
    HARNESS_NAMES,
    type HarnessName,
  } from '../stores/harnessAliases';

  const dispatch = createEventDispatcher<{ close: void }>();
  type SettingsView = 'preferences' | 'shortcuts';
  type ShortcutGroup = {
    title: string;
    shortcuts: Array<{
      keys: string[];
      action: string;
    }>;
  };

  const shortcutGroups: ShortcutGroup[] = [
    {
      title: 'Global',
      shortcuts: [
        { keys: ['Cmd/Ctrl+N'], action: 'Launch a node with the current launcher form' },
        { keys: ['Cmd/Ctrl+W'], action: 'Close the selected agent window, or request app close' },
        { keys: ['Cmd/Ctrl+,'], action: 'Open settings' },
      ],
    },
    {
      title: 'Canvas',
      shortcuts: [
        { keys: ['Cmd/Ctrl+Shift+]'], action: 'Select or cycle to the next agent window and center it' },
        { keys: ['Cmd/Ctrl+Shift+['], action: 'Select or cycle to the previous agent window and center it' },
        { keys: ['Cmd/Ctrl+Alt/Opt+C'], action: 'Center the selected or focused agent window' },
        { keys: ['Cmd/Ctrl+Alt/Opt+0'], action: 'Fit all visible agent windows in view' },
        { keys: ['Cmd/Ctrl+Shift+M'], action: 'Compact or expand the selected agent window' },
        { keys: ['Cmd/Ctrl+Alt/Opt+F'], action: 'Fill the canvas with the selected agent window' },
        { keys: ['Cmd/Ctrl+Shift+F'], action: 'Open the selected agent window in immersive workspace' },
      ],
    },
    {
      title: 'Alignment',
      shortcuts: [
        { keys: ['Drag near center line'], action: 'Snap to another agent window center line' },
        { keys: ['Cmd/Ctrl+Alt/Opt+]', 'Cmd/Ctrl+Alt/Opt+}'], action: 'Align to the next target agent window center line' },
        { keys: ['Cmd/Ctrl+Alt/Opt+[', 'Cmd/Ctrl+Alt/Opt+{'], action: 'Align to the previous target agent window center line' },
        { keys: ['Cmd/Ctrl+Alt/Opt+\\', 'Cmd/Ctrl+Alt/Opt+|'], action: 'Toggle vertical or horizontal center-line alignment' },
        { keys: ['Cmd/Ctrl+Alt/Opt+;'], action: 'Place beside target forward through left, top, right, bottom' },
        { keys: ['Cmd/Ctrl+Alt/Opt+:'], action: 'Place beside target backward through left, bottom, right, top' },
        { keys: ['Cmd/Ctrl+Alt/Opt+=', 'Cmd/Ctrl+Alt/Opt++'], action: 'Add space from the alignment target' },
        { keys: ['Cmd/Ctrl+Alt/Opt+-'], action: 'Remove space from the alignment target' },
      ],
    },
    {
      title: 'Immersive Workspace',
      shortcuts: [
        { keys: ['Esc', 'Cmd/Ctrl+Shift+F'], action: 'Close immersive workspace' },
        { keys: ['Cmd/Ctrl+W'], action: 'Close the active agent tab' },
        { keys: ['Cmd/Ctrl+`'], action: 'Switch focused pane when split is active' },
        { keys: ['Cmd/Ctrl+Shift+\\'], action: 'Toggle split view' },
        { keys: ['Cmd/Ctrl+Shift+]'], action: 'Cycle to next tab in focused pane' },
        { keys: ['Cmd/Ctrl+Shift+['], action: 'Cycle to previous tab in focused pane' },
      ],
    },
    {
      title: 'Dialogs',
      shortcuts: [
        { keys: ['Esc'], action: 'Close the current settings, pairing, mobile, or confirm dialog' },
        { keys: ['Enter'], action: 'Confirm app close when the close confirmation dialog is open' },
      ],
    },
  ];

  let activeView: SettingsView = 'preferences';

  function closeSettings() {
    dispatch('close');
  }

  function handleBackgroundOpacityInput(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    appearance.setBackgroundOpacity(Number(target.value) / 100);
  }

  function handleAgentWindowWidthInput(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    agentWindowSettings.setDefaultWidth(Number(target.value));
  }

  function handleAgentWindowHeightInput(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    agentWindowSettings.setDefaultHeight(Number(target.value));
  }

  function handleCenterOnSpawnInput(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    agentWindowSettings.setCenterOnSpawn(target.checked);
  }

  function handleAliasInput(harness: HarnessName, event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    harnessAliases.setAlias(harness, target.value);
  }

  function resetDefaults() {
    appearance.reset();
    agentWindowSettings.reset();
    harnessAliases.reset();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSettings();
    }
  }
</script>

<svelte:window on:keydown={handleWindowKeydown} />

<div class="settings-overlay">
  <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <div class="settings-header">
      <div>
        <h2 id="settings-title">Settings</h2>
        <p>Adjust preferences and review keyboard shortcuts.</p>
      </div>

      <button type="button" class="close-btn" on:click={closeSettings} aria-label="Close settings">
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M3 3 L11 11 M11 3 L3 11" />
        </svg>
      </button>
    </div>

    <div class="settings-tabs" role="tablist" aria-label="Settings views">
      <button
        type="button"
        role="tab"
        class:active={activeView === 'preferences'}
        aria-selected={activeView === 'preferences'}
        on:click={() => (activeView = 'preferences')}
      >
        Preferences
      </button>
      <button
        type="button"
        role="tab"
        class:active={activeView === 'shortcuts'}
        aria-selected={activeView === 'shortcuts'}
        on:click={() => (activeView = 'shortcuts')}
      >
        Shortcuts
      </button>
    </div>

    <div class="settings-body">
      {#if activeView === 'preferences'}
        <section>
          <h3>Appearance</h3>

          <div class="setting-row">
            <div class="setting-copy">
              <label for="settings-background-opacity">Background Opacity</label>
              <p>Lower values let more of the desktop show through the canvas, panels, and terminals.</p>
            </div>

            <div class="setting-control">
              <span class="setting-value">{Math.round($appearance.backgroundOpacity * 100)}%</span>
              <input
                id="settings-background-opacity"
                type="range"
                min="25"
                max="100"
                step="1"
                value={Math.round($appearance.backgroundOpacity * 100)}
                on:input={handleBackgroundOpacityInput}
              />
            </div>
          </div>
        </section>

        <section class="agent-window-section">
          <h3>Agent Windows</h3>

          <div class="setting-row">
            <div class="setting-copy">
              <label for="settings-agent-window-width">Default Width</label>
              <p>Applied to newly spawned agent windows.</p>
            </div>

            <div class="setting-control">
              <span class="setting-value">{$agentWindowSettings.defaultWidth}px</span>
              <input
                id="settings-agent-window-width"
                type="range"
                min={AGENT_WINDOW_WIDTH_MIN}
                max={AGENT_WINDOW_WIDTH_MAX}
                step="20"
                value={$agentWindowSettings.defaultWidth}
                on:input={handleAgentWindowWidthInput}
              />
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-copy">
              <label for="settings-agent-window-height">Default Height</label>
              <p>Applied to newly spawned agent windows.</p>
            </div>

            <div class="setting-control">
              <span class="setting-value">{$agentWindowSettings.defaultHeight}px</span>
              <input
                id="settings-agent-window-height"
                type="range"
                min={AGENT_WINDOW_HEIGHT_MIN}
                max={AGENT_WINDOW_HEIGHT_MAX}
                step="20"
                value={$agentWindowSettings.defaultHeight}
                on:input={handleAgentWindowHeightInput}
              />
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-copy">
              <label for="settings-center-on-spawn">Center On Spawn</label>
              <p>Pan to newly spawned agent windows after launch.</p>
            </div>

            <div class="setting-control checkbox-control">
              <input
                id="settings-center-on-spawn"
                type="checkbox"
                checked={$agentWindowSettings.centerOnSpawn}
                on:change={handleCenterOnSpawnInput}
              />
            </div>
          </div>
        </section>

        <section class="harness-section">
          <h3>Harness Commands</h3>
          <p class="section-hint">
            Override the shell command used when launching each harness. Useful if
            your binary lives under a different name (e.g. <code>claude</code> →
            <code>clowd</code>).
          </p>

          {#each HARNESS_NAMES as harness (harness)}
            <div class="setting-row">
              <div class="setting-copy">
                <label for={`settings-harness-${harness}`}>{harness}</label>
                <p>Default: <code>{harness}</code></p>
              </div>

              <div class="setting-control alias-control">
                <input
                  id={`settings-harness-${harness}`}
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  autocapitalize="off"
                  placeholder={harness}
                  value={$harnessAliases[harness]}
                  on:input={(event) => handleAliasInput(harness, event)}
                />
              </div>
            </div>
          {/each}
        </section>
      {:else}
        <section class="shortcuts-section">
          {#each shortcutGroups as group (group.title)}
            <div class="shortcut-group">
              <h3>{group.title}</h3>

              <div class="shortcut-list">
                {#each group.shortcuts as shortcut (shortcut.action)}
                  <div class="shortcut-row">
                    <div class="shortcut-keys" aria-label={shortcut.keys.join(' or ')}>
                      {#each shortcut.keys as key (key)}
                        <kbd>{key}</kbd>
                      {/each}
                    </div>
                    <div class="shortcut-action">{shortcut.action}</div>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </section>
      {/if}
    </div>

    <div class="settings-footer">
      {#if activeView === 'preferences'}
        <button type="button" class="secondary-btn" on:click={resetDefaults}>
          Reset Defaults
        </button>
      {/if}
      <button type="button" class="primary-btn" on:click={closeSettings}>
        Done
      </button>
    </div>
  </div>
</div>

<style>
  .settings-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(6, 7, 12, 0.42);
    backdrop-filter: blur(18px) saturate(1.08);
    -webkit-backdrop-filter: blur(18px) saturate(1.08);
  }

  .settings-modal {
    width: min(680px, 100%);
    border: 1px solid var(--node-border, rgba(108, 112, 134, 0.44));
    border-radius: 16px;
    background: var(--panel-bg, rgba(30, 30, 46, 0.68));
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.38);
    backdrop-filter: blur(var(--surface-blur, 20px)) saturate(1.12);
    -webkit-backdrop-filter: blur(var(--surface-blur, 20px)) saturate(1.12);
    overflow: hidden;
  }

  .settings-header,
  .settings-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 18px 20px;
    border-bottom: 1px solid var(--node-border, rgba(108, 112, 134, 0.44));
  }

  .settings-footer {
    border-top: 1px solid var(--node-border, rgba(108, 112, 134, 0.44));
    border-bottom: none;
  }

  .settings-tabs {
    display: flex;
    gap: 4px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--node-border, rgba(108, 112, 134, 0.44));
    background: rgba(17, 17, 27, 0.24);
  }

  .settings-tabs button {
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 7px 10px;
    background: transparent;
    color: #8f94b2;
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
  }

  .settings-tabs button:hover {
    color: var(--terminal-fg, #c0caf5);
    background: rgba(108, 112, 134, 0.14);
  }

  .settings-tabs button.active {
    color: var(--terminal-fg, #c0caf5);
    border-color: rgba(137, 180, 250, 0.34);
    background: rgba(137, 180, 250, 0.13);
  }

  .settings-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 650;
    color: var(--terminal-fg, #c0caf5);
  }

  .settings-header p {
    margin: 6px 0 0;
    font-size: 12px;
    color: #8f94b2;
  }

  .settings-body {
    padding: 20px;
    max-height: min(68vh, 720px);
    overflow-y: auto;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .agent-window-section,
  .harness-section {
    margin-top: 20px;
  }

  .section-hint {
    margin: -4px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: #8f94b2;
  }

  .section-hint code,
  .setting-copy code {
    font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
    font-size: 11px;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(108, 112, 134, 0.22);
    color: var(--terminal-fg, #c0caf5);
  }

  .alias-control input[type='text'] {
    padding: 6px 10px;
    font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
    font-size: 12px;
    color: var(--terminal-fg, #c0caf5);
    background: rgba(17, 17, 27, 0.65);
    border: 1px solid var(--node-border, rgba(108, 112, 134, 0.44));
    border-radius: 8px;
    outline: none;
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .alias-control input[type='text']:focus {
    border-color: var(--status-pending, #89b4fa);
    background: rgba(17, 17, 27, 0.82);
  }

  h3 {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #a6adc8;
  }

  .setting-row {
    display: flex;
    gap: 20px;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    border: 1px solid var(--node-border, rgba(108, 112, 134, 0.44));
    border-radius: 12px;
    background: var(--node-header-bg, rgba(24, 24, 37, 0.82));
  }

  .setting-copy {
    flex: 1;
    min-width: 0;
  }

  .setting-copy label {
    display: block;
    margin-bottom: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--terminal-fg, #c0caf5);
  }

  .setting-copy p {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: #8f94b2;
  }

  .setting-control {
    width: 180px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .setting-control input {
    width: 100%;
    margin: 0;
    accent-color: var(--status-pending, #89b4fa);
    cursor: pointer;
  }

  .checkbox-control {
    align-items: flex-end;
  }

  .checkbox-control input[type='checkbox'] {
    width: 18px;
    height: 18px;
  }

  .setting-value {
    align-self: flex-end;
    font-size: 12px;
    font-weight: 700;
    color: var(--terminal-fg, #c0caf5);
  }

  .shortcuts-section {
    gap: 22px;
  }

  .shortcut-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .shortcut-list {
    border: 1px solid var(--node-border, rgba(108, 112, 134, 0.44));
    border-radius: 8px;
    background: var(--node-header-bg, rgba(24, 24, 37, 0.82));
    overflow: hidden;
  }

  .shortcut-row {
    display: grid;
    grid-template-columns: minmax(190px, 0.8fr) minmax(0, 1fr);
    gap: 16px;
    align-items: center;
    padding: 11px 12px;
    border-bottom: 1px solid rgba(108, 112, 134, 0.22);
  }

  .shortcut-row:last-child {
    border-bottom: none;
  }

  .shortcut-keys {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
  }

  .shortcut-keys kbd {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 2px 7px;
    border: 1px solid rgba(108, 112, 134, 0.5);
    border-radius: 5px;
    background: rgba(17, 17, 27, 0.72);
    color: var(--terminal-fg, #c0caf5);
    font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
    font-size: 11px;
    line-height: 1.2;
    white-space: nowrap;
  }

  .shortcut-action {
    min-width: 0;
    color: #bac2de;
    font-size: 12px;
    line-height: 1.4;
  }

  .secondary-btn,
  .primary-btn {
    border: 1px solid var(--node-border, rgba(108, 112, 134, 0.44));
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .secondary-btn {
    background: var(--node-header-bg, rgba(24, 24, 37, 0.82));
    color: var(--terminal-fg, #c0caf5);
  }

  .close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: #8f94b2;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }

  .close-btn:hover {
    color: var(--terminal-fg, #c0caf5);
    background: rgba(108, 112, 134, 0.18);
    border-color: var(--node-border, rgba(108, 112, 134, 0.44));
  }

  .primary-btn {
    background: var(--status-pending, #89b4fa);
    border-color: color-mix(in srgb, var(--status-pending, #89b4fa) 72%, black);
    color: #10131a;
  }

  .settings-footer {
    justify-content: flex-end;
  }

  .settings-footer .secondary-btn {
    margin-right: auto;
  }

  .secondary-btn:hover {
    background: color-mix(in srgb, var(--node-header-bg, rgba(24, 24, 37, 0.82)) 84%, white);
  }

  .primary-btn:hover {
    background: color-mix(in srgb, var(--status-pending, #89b4fa) 84%, white);
  }

  @media (max-width: 640px) {
    .settings-overlay {
      padding: 12px;
      align-items: flex-end;
    }

    .settings-modal {
      width: 100%;
    }

    .settings-tabs {
      padding: 10px 12px;
    }

    .setting-row {
      flex-direction: column;
      align-items: stretch;
    }

    .setting-control {
      width: 100%;
    }

    .shortcut-row {
      grid-template-columns: 1fr;
      gap: 8px;
    }
  }
</style>
