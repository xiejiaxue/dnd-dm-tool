import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type RoomBootstrap } from './api';
import type { Op } from './types';
import BoardCanvas from './components/BoardCanvas';
import EnemyList from './components/EnemyList';
import InitiativePanel from './components/InitiativePanel';
import QueryPanel from './components/QueryPanel';
import Toolbar from './components/Toolbar';
import TopBar from './components/TopBar';
import DiceTray from './features/dice/DiceTray';
import MacroHotbar from './features/macros/MacroHotbar';
import { MapUploadProvider } from './features/map-upload/MapUploadProvider';
import { setPendingMapNote, subscribePendingMapNote, type PendingMapNote } from './features/journal/mapNotePlacement';
import { subscribe, type PendingToken } from './pending';
import { useScene } from './ws';
import { connection } from './ws';
import { DockResizeHandle, FloatingWorkspacePanel } from './features/workspace/WorkspaceChrome';
import { useWorkspaceLayout } from './features/workspace/useWorkspaceLayout';
import { useCommandHistory } from './features/history/useCommandHistory';
import { invertBoardOperations } from './features/history/invertBoardOperations';
import type { PlaceableRef } from './features/board/placeables';
import { BoardCommandProvider } from './features/history/BoardCommandContext';
import { ActionLogProvider } from './features/action-log/ActionLogContext';
import { TabletopSettingsProvider, eventMatchesBinding, useTabletopSettings } from './features/settings/TabletopSettingsContext';
import CommandPalette, { type PaletteCommand } from './features/settings/CommandPalette';
import { openJournal } from './documents/navigation';
import { openActorSheet } from './features/actors/navigation';
import { openToolDocument } from './features/tools/navigation';
import EffectRoundSynchronizer from './features/effects/EffectRoundSynchronizer';
import EncounterEventLogger from './features/encounter/EncounterEventLogger';
import { extensionRegistry } from './extensions/registry';
import { emitCommittedOperationHooks } from './extensions/board-hooks';
import { subscribeDocumentMutations } from './extensions/mutation-events';
import { asOps } from './realtime/protocol';

interface Props {
  room: RoomBootstrap;
  onLeaveRoom: () => void;
}

/**
 * Owns only the interactive tabletop composition. Routing and room-session
 * bootstrapping stay in App, while feature providers hide API/transport details
 * from the visual shell below.
 */
export default function RoomTable({ room, onLeaveRoom }: Props) {
  const { role, scene, encounter, activeSceneId } = useScene();
  const [tool, setTool] = useState('select');
  const [pending, setPending] = useState<PendingToken | null>(null);
  const [selectedPlaceables, setSelectedPlaceables] = useState<PlaceableRef[]>([]);
  const [diceOpen, setDiceOpen] = useState(false);
  const [pendingNote, setPendingNote] = useState<PendingMapNote | null>(null);
  const workspace = useWorkspaceLayout(room.room.slug);
  const history = useCommandHistory();
  const { layout } = workspace;
  const previousSceneId = useRef<string | undefined>(scene?.id);
  const previousActiveSceneId = useRef<string | null>(null);
  const readyEmitted = useRef(false);

  useEffect(() => {
    if (readyEmitted.current) return;
    readyEmitted.current = true;
    void extensionRegistry.emit('ready', { roomSlug: room.room.slug });
  }, [room.room.slug]);

  useEffect(() => subscribeDocumentMutations(mutation => {
    const hook = mutation.action === 'created' ? 'documentCreated' : mutation.action === 'updated' ? 'documentUpdated' : 'documentDeleted';
    void extensionRegistry.emit(hook, { ...mutation, roomSlug: room.room.slug });
  }), [room.room.slug]);

  useEffect(() => connection.onMessage(message => {
    if (message.type !== 'committedOps') return;
    const operations = asOps(message.ops);
    if (!operations) return;
    void emitCommittedOperationHooks(extensionRegistry, operations, {
      roomSlug: room.room.slug,
      sceneId: connection.lastState?.scene.id ?? null,
      revision: typeof message.revision === 'number' ? message.revision : null,
    });
  }), [room.room.slug]);

  useEffect(() => {
    if (!activeSceneId || previousActiveSceneId.current === activeSceneId) return;
    const previous = previousActiveSceneId.current;
    previousActiveSceneId.current = activeSceneId;
    void extensionRegistry.emit('sceneActivated', { roomSlug: room.room.slug, sceneId: activeSceneId, previousSceneId: previous });
  }, [activeSceneId, room.room.slug]);

  useEffect(() => subscribe(pickedUp => {
    setPending(pickedUp);
    if (pickedUp && role === 'dm') setTool('add');
  }), [role]);

  useEffect(() => subscribePendingMapNote(note => {
    setPendingNote(note);
    if (note && role === 'dm') setTool('note');
  }), [role]);

  useEffect(() => {
    const available = new Set([...(scene?.tokens ?? []), ...(scene?.players ?? [])].map(token => token.id));
    const walls = new Set(scene?.walls.map(wall => wall.id) ?? []);
    setSelectedPlaceables(current => current.filter(ref => ref.kind === 'note' || (ref.kind === 'token' ? available.has(ref.id) : walls.has(ref.id))));
  }, [scene?.id, scene?.tokens, scene?.players, scene?.walls]);

  useEffect(() => {
    if (previousSceneId.current === scene?.id) return;
    previousSceneId.current = scene?.id;
    setSelectedPlaceables([]);
    history.clear();
  }, [scene?.id, history.clear]);

  const performOps = useCallback((label: string, operations: Op[]) => {
    if (!scene || operations.length === 0) return;
    const current = connection.lastState;
    const inverse = invertBoardOperations(current?.scene ?? scene, current?.encounter ?? encounter, operations);
    connection.sendOps(operations);
    if (!inverse) return;
    history.record({
      label,
      undo: () => connection.sendOps(inverse),
      redo: () => connection.sendOps(operations),
    });
  }, [encounter, history.record, scene]);

  const selectedIds = selectedPlaceables.filter(ref => ref.kind === 'token').map(ref => ref.id);
  const selectedId = selectedIds.at(-1) ?? null;

  return (
    <MapUploadProvider>
      <BoardCommandProvider performOps={performOps}>
      <TabletopSettingsProvider>
      <ActionLogProvider selectedTokenIds={selectedIds}>
      <div className="flex h-full flex-col">
        <EffectRoundSynchronizer roomSlug={room.room.slug} />
        <EncounterEventLogger roomSlug={room.room.slug} />
        {!layout.presentation && <TopBar roomName={room.room.name} roomSlug={room.room.slug} onLeaveRoom={onLeaveRoom} />}
        {!layout.presentation && <InitiativePanel selectedTokenIds={selectedIds} onClearSelected={() => setSelectedPlaceables([])} />}
        <div className="relative flex min-h-0 flex-1">
          {!layout.presentation && <Toolbar
            role={role}
            tool={tool}
            onTool={setTool}
            pendingLabel={pendingNote ? `点击棋盘放置标记：${pendingNote.label}` : pending ? `点击棋盘放置：${pending.name}（按住 Shift 仅主持人可见）` : null}
            canPlaceToken={Boolean(pending)}
            canPlaceNote={Boolean(pendingNote)}
            diceOpen={diceOpen}
            onToggleDice={() => setDiceOpen(open => !open)}
          />}
          {!layout.presentation && layout.encounterVisible && layout.encounterMode === 'docked' && (
            <div className="relative shrink-0" style={{ width: layout.encounterWidth }}>
              <EnemyList selectedTokenId={selectedId} />
              <DockResizeHandle side="left" onResize={width => workspace.setPanelWidth('encounter', width)} />
            </div>
          )}
          <div className="flex-1 min-w-0 relative bg-zinc-900">
            <BoardCanvas
              tool={tool}
              pending={pending}
              pendingNote={pendingNote}
              onClearPending={() => setPending(null)}
              onClearPendingNote={() => setPendingMapNote(null)}
              selectedPlaceables={selectedPlaceables}
              onSelectionChange={setSelectedPlaceables}
              onPerformOps={performOps}
              onRecordHistory={history.record}
              presentation={layout.presentation}
            />
            <DiceTray open={diceOpen} onClose={() => setDiceOpen(false)} />
            {!layout.presentation && <MacroHotbar onSelectTool={setTool} onOpenLibrary={() => workspace.setPanelVisible('library', true)} />}
            <WorkspaceControls
              presentation={layout.presentation}
              encounterVisible={layout.encounterVisible}
              libraryVisible={layout.libraryVisible}
              encounterMode={layout.encounterMode}
              libraryMode={layout.libraryMode}
              onToggleEncounter={() => workspace.setPanelVisible('encounter', !layout.encounterVisible)}
              onToggleLibrary={() => workspace.setPanelVisible('library', !layout.libraryVisible)}
              onFloatEncounter={() => workspace.setPanelMode('encounter', layout.encounterMode === 'floating' ? 'docked' : 'floating')}
              onFloatLibrary={() => workspace.setPanelMode('library', layout.libraryMode === 'floating' ? 'docked' : 'floating')}
              onPresentation={() => workspace.update({ presentation: !layout.presentation })}
              onReset={workspace.reset}
              canUndo={history.canUndo}
              canRedo={history.canRedo}
              undoLabel={history.undoLabel}
              redoLabel={history.redoLabel}
              notice={history.notice}
              onUndo={() => void history.undo()}
              onRedo={() => void history.redo()}
            />
            <RoomCommandLayer
              role={role}
              diceOpen={diceOpen}
              onToggleDice={() => setDiceOpen(open => !open)}
              encounterVisible={layout.encounterVisible}
              libraryVisible={layout.libraryVisible}
              onToggleEncounter={() => workspace.setPanelVisible('encounter', !layout.encounterVisible)}
              onToggleLibrary={() => workspace.setPanelVisible('library', !layout.libraryVisible)}
              onShowLibrary={() => workspace.setPanelVisible('library', true)}
              canUndo={history.canUndo}
              canRedo={history.canRedo}
              onUndo={() => void history.undo()}
              onRedo={() => void history.redo()}
              onPresentation={() => workspace.update({ presentation: !layout.presentation })}
              onReset={workspace.reset}
            />
          </div>
          {!layout.presentation && layout.libraryVisible && layout.libraryMode === 'docked' && (
            <div className="relative shrink-0" style={{ width: layout.libraryWidth }}>
              <DockResizeHandle side="right" onResize={width => workspace.setPanelWidth('library', width)} />
              <QueryPanel collapsed={false} onToggleCollapsed={() => workspace.setPanelVisible('library', false)} onSelectTool={setTool}
                onRequestFloat={() => workspace.setPanelMode('library', 'floating')} />
            </div>
          )}
          {!layout.presentation && layout.encounterVisible && layout.encounterMode === 'floating' && (
            <FloatingWorkspacePanel panel="encounter" title="敌人 / NPC" rect={layout.encounterRect}
              onRect={rect => workspace.setPanelRect('encounter', rect)} onDock={() => workspace.setPanelMode('encounter', 'docked')}
              onClose={() => workspace.setPanelVisible('encounter', false)} active={layout.focusedPanel === 'encounter'}
              onFocus={() => workspace.focusPanel('encounter')}>
              <EnemyList selectedTokenId={selectedId} />
            </FloatingWorkspacePanel>
          )}
          {!layout.presentation && layout.libraryVisible && layout.libraryMode === 'floating' && (
            <FloatingWorkspacePanel panel="library" title="资料与文档" rect={layout.libraryRect}
              onRect={rect => workspace.setPanelRect('library', rect)} onDock={() => workspace.setPanelMode('library', 'docked')}
              onClose={() => workspace.setPanelVisible('library', false)} active={layout.focusedPanel === 'library'}
              onFocus={() => workspace.focusPanel('library')}>
              <QueryPanel collapsed={false} onToggleCollapsed={() => workspace.setPanelVisible('library', false)} onSelectTool={setTool} />
            </FloatingWorkspacePanel>
          )}
        </div>
      </div>
      </ActionLogProvider>
      </TabletopSettingsProvider>
      </BoardCommandProvider>
    </MapUploadProvider>
  );
}

function RoomCommandLayer({ role, diceOpen, onToggleDice, encounterVisible, libraryVisible, onToggleEncounter, onToggleLibrary, onShowLibrary,
  canUndo, canRedo, onUndo, onRedo, onPresentation, onReset }: {
  role: string; diceOpen: boolean; onToggleDice(): void; encounterVisible: boolean; libraryVisible: boolean;
  onToggleEncounter(): void; onToggleLibrary(): void; onShowLibrary(): void; canUndo: boolean; canRedo: boolean; onUndo(): void; onRedo(): void;
  onPresentation(): void; onReset(): void;
}) {
  const { settings } = useTabletopSettings();
  const [open, setOpen] = useState(false);
  const [documents, setDocuments] = useState<{ actors: { id: string; name: string }[]; journals: { id: string; name: string }[]; items: { id: string; name: string }[] }>({ actors: [], journals: [], items: [] });
  useEffect(() => connection.onMessage(message => {
    if (message.type !== 'showJournal' || typeof message.journalId !== 'string') return;
    onShowLibrary();
    openJournal({ journalId: message.journalId, pageId: typeof message.pageId === 'string' ? message.pageId : null });
  }), [onShowLibrary]);
  useEffect(() => {
    if (!open) return;
    void Promise.all([
      api.actors().then(value => value.actors).catch(() => []),
      api.journals().catch(() => []),
      api.items().catch(() => []),
    ]).then(([actors, journals, items]) => setDocuments({ actors, journals, items }));
  }, [open]);
  const commands: PaletteCommand[] = [
    { id: 'ui.toggle-dice', label: diceOpen ? '关闭掷骰板' : '打开掷骰板', keywords: '骰子 dice', run: onToggleDice },
    { id: 'ui.toggle-library', label: libraryVisible ? '隐藏资料栏' : '显示资料栏', keywords: '右侧 文档', run: onToggleLibrary },
    { id: 'ui.toggle-encounter', label: encounterVisible ? '隐藏敌人栏' : '显示敌人栏', keywords: '左侧 战斗', run: onToggleEncounter },
    { id: 'history.undo', label: '撤销上一步地图操作', disabled: !canUndo, run: onUndo },
    { id: 'history.redo', label: '重做地图操作', disabled: !canRedo, run: onRedo },
    { id: 'encounter.next-turn', label: '战斗：下一行动', disabled: role !== 'dm', run: () => connection.sendOps([{ op: 'nextTurn' }]) },
    { id: 'ui.presentation', label: '切换纯地图模式', run: onPresentation },
    { id: 'ui.reset-workspace', label: '恢复默认工作区布局', run: onReset },
    ...documents.actors.map(actor => ({ id: `actor.${actor.id}`, label: `打开角色：${actor.name}`, keywords: `actor npc 角色 ${actor.name}`, run: () => { onShowLibrary(); openActorSheet(actor.id); } })),
    ...documents.journals.map(journal => ({ id: `journal.${journal.id}`, label: `打开日志：${journal.name}`, keywords: `journal handout 日志 手册 ${journal.name}`, run: () => { onShowLibrary(); openJournal({ journalId: journal.id }); } })),
    ...documents.items.map(item => ({ id: `item.${item.id}`, label: `打开物品：${item.name}`, keywords: `item 物品 装备 ${item.name}`, run: () => { onShowLibrary(); openToolDocument({ type: 'item', id: item.id }); } })),
  ];
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = Boolean(target?.closest('input,textarea,select,[contenteditable="true"]'));
      if (eventMatchesBinding(event, settings.keybindings['ui.command-palette'] ?? 'Mod+K')) { event.preventDefault(); setOpen(value => !value); return; }
      if (editing || open) return;
      const byId = new Map(commands.map(command => [command.id, command]));
      for (const [id, binding] of Object.entries(settings.keybindings)) {
        if (!eventMatchesBinding(event, binding)) continue;
        const command = byId.get(id);
        if (!command || command.disabled || id === 'ui.command-palette') continue;
        event.preventDefault(); command.run(); return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commands, open, settings.keybindings]);
  return <CommandPalette open={open} commands={commands} onClose={() => setOpen(false)} />;
}

function WorkspaceControls({ presentation, encounterVisible, libraryVisible, encounterMode, libraryMode, onToggleEncounter, onToggleLibrary,
  onFloatEncounter, onFloatLibrary, onPresentation, onReset, canUndo, canRedo, undoLabel, redoLabel, notice, onUndo, onRedo }: {
  presentation: boolean;
  encounterVisible: boolean;
  libraryVisible: boolean;
  encounterMode: 'docked' | 'floating';
  libraryMode: 'docked' | 'floating';
  onToggleEncounter(): void;
  onToggleLibrary(): void;
  onFloatEncounter(): void;
  onFloatLibrary(): void;
  onPresentation(): void;
  onReset(): void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
  notice: string;
  onUndo(): void;
  onRedo(): void;
}) {
  if (presentation) return <button type="button" onClick={onPresentation} className="absolute right-3 top-3 z-50 rounded bg-zinc-900/90 px-3 py-2 text-xs text-zinc-200 shadow-lg">退出纯地图</button>;
  return (
    <div className="absolute left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900/85 p-1 text-[10px] text-zinc-300 shadow-lg backdrop-blur">
      <button type="button" onClick={onToggleEncounter} className={`rounded px-2 py-1 hover:bg-zinc-700 ${encounterVisible ? 'text-amber-300' : 'text-zinc-500'}`}>敌人栏</button>
      <button type="button" onClick={onFloatEncounter} className="rounded px-2 py-1 hover:bg-zinc-700">{encounterMode === 'floating' ? '敌人停靠' : '敌人浮动'}</button>
      <button type="button" onClick={onToggleLibrary} className={`rounded px-2 py-1 hover:bg-zinc-700 ${libraryVisible ? 'text-amber-300' : 'text-zinc-500'}`}>资料栏</button>
      <button type="button" onClick={onFloatLibrary} className="rounded px-2 py-1 hover:bg-zinc-700">{libraryMode === 'floating' ? '资料停靠' : '资料浮动'}</button>
      <span className="mx-1 h-4 w-px bg-zinc-700" />
      <button type="button" onClick={onUndo} disabled={!canUndo} title={undoLabel ? `撤销：${undoLabel}` : '无可撤销操作'} className="rounded px-2 py-1 hover:bg-zinc-700 disabled:text-zinc-700">撤销</button>
      <button type="button" onClick={onRedo} disabled={!canRedo} title={redoLabel ? `重做：${redoLabel}` : '无可重做操作'} className="rounded px-2 py-1 hover:bg-zinc-700 disabled:text-zinc-700">重做</button>
      <button type="button" onClick={onPresentation} className="rounded px-2 py-1 hover:bg-zinc-700">纯地图</button>
      <button type="button" onClick={onReset} title="恢复默认工作区" className="rounded px-2 py-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200">重置</button>
      {notice && <span className="max-w-32 truncate px-1 text-zinc-500" title={notice}>{notice}</span>}
    </div>
  );
}
