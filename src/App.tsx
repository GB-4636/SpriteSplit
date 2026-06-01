import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import { open } from '@tauri-apps/plugin-dialog'

import './App.css'
import {
  analyzeImage,
  exportProject,
  filePathToUrl,
  generateDescriptions,
  isTauriRuntime,
} from './tauri'
import type {
  BoundingBox,
  ExportResult,
  ExportSettings,
  ProjectDocument,
  ProviderConfig,
  SpriteRecord,
} from './types'

type ToolMode = 'select' | 'create'
type SidebarTab = 'inspect' | 'ai' | 'export'
type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'

type InteractionState =
  | {
      type: 'move'
      origin: { x: number; y: number }
      baseProject: ProjectDocument
      spriteIds: string[]
    }
  | {
      type: 'resize'
      origin: { x: number; y: number }
      baseProject: ProjectDocument
      spriteId: string
      handle: ResizeHandle
    }
  | {
      type: 'create'
      origin: { x: number; y: number }
      baseProject: ProjectDocument
      previewId: string
    }

const defaultDetectionSettings = {
  alphaThreshold: 10,
  minArea: 16,
  sortMode: 'top-to-bottom-left-to-right',
} as const

const defaultProviderConfig: ProviderConfig = {
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4.1-mini',
  sheetPrompt:
    'Summarize this sprite sheet in one short paragraph for asset management. Focus on style, subject matter, and repeated motifs.',
  spritePrompt:
    'Describe this sprite briefly for naming and cataloging. Return one concise sentence.',
}

const defaultExportSettings: ExportSettings = {
  outputDir: '',
  exportCrops: true,
  normalizeCanvas: false,
  canvasWidth: 256,
  canvasHeight: 256,
  includeJson: true,
  includeCsv: true,
}

function App() {
  const [project, setProject] = useState<ProjectDocument | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [tool, setTool] = useState<ToolMode>('select')
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('inspect')
  const [zoom, setZoom] = useState(1)
  const [providerConfig, setProviderConfig] =
    useState<ProviderConfig>(defaultProviderConfig)
  const [exportSettings, setExportSettings] =
    useState<ExportSettings>(defaultExportSettings)
  const [history, setHistory] = useState<{
    entries: ProjectDocument[]
    index: number
  }>({ entries: [], index: -1 })
  const [interaction, setInteraction] = useState<InteractionState | null>(null)
  const [status, setStatus] = useState(
    'Import a PNG sprite image to begin detection and editing.',
  )
  const [error, setError] = useState('')
  const [busyLabel, setBusyLabel] = useState('')

  const stageRef = useRef<HTMLDivElement | null>(null)
  const projectRef = useRef<ProjectDocument | null>(null)
  const draftIdRef = useRef(1)

  useEffect(() => {
    projectRef.current = project
  }, [project])

  const activeSprite =
    selectedIds.length === 1
      ? project?.sprites.find((sprite) => sprite.id === selectedIds[0]) ?? null
      : null

  const stageWidth = project ? project.imageSize.width * zoom : 0
  const stageHeight = project ? project.imageSize.height * zoom : 0

  const pushHistory = (next: ProjectDocument) => {
    setHistory((current) => {
      const entries = current.entries.slice(0, current.index + 1)
      entries.push(structuredClone(next))
      return { entries, index: entries.length - 1 }
    })
  }

  const replaceProject = (
    next: ProjectDocument,
    options: {
      resetHistory?: boolean
      push?: boolean
      selection?: string[]
    } = {},
  ) => {
    const normalized = normalizeProject(next)
    projectRef.current = normalized
    startTransition(() => {
      setProject(normalized)
    })

    if (options.resetHistory) {
      setHistory({
        entries: [structuredClone(normalized)],
        index: 0,
      })
    } else if (options.push) {
      pushHistory(normalized)
    }

    if (options.selection) {
      setSelectedIds(options.selection)
    }
  }

  const updateProject = (
    updater: (draft: ProjectDocument) => ProjectDocument,
    options: { push?: boolean; selection?: string[] } = {},
  ) => {
    const current = projectRef.current
    if (!current) {
      return
    }
    const next = updater(structuredClone(current))
    replaceProject(next, { push: options.push, selection: options.selection })
  }

  const importImage = async () => {
    if (!isTauriRuntime()) {
      setError('The desktop runtime is required for file import.')
      return
    }

    const chosen = await open({
      multiple: false,
      filters: [
        {
          name: 'PNG Sprite Sheets',
          extensions: ['png'],
        },
      ],
    })

    if (!chosen || Array.isArray(chosen)) {
      return
    }

    setError('')
    setBusyLabel('Analyzing sprite sheet...')
    setStatus('Running alpha-based detection...')

    try {
      const nextProject = await analyzeImage({
        imagePath: chosen,
        settings: project?.detectionSettings ?? defaultDetectionSettings,
        prompt: project?.prompt ?? '',
      })
      replaceProject(nextProject, {
        resetHistory: true,
        selection: nextProject.sprites[0] ? [nextProject.sprites[0].id] : [],
      })
      setPreviewUrl(filePathToUrl(chosen))
      setExportSettings((current) => ({
        ...current,
        outputDir: current.outputDir || deriveDefaultExportDir(chosen),
      }))
      setStatus(
        `Detected ${nextProject.sprites.length} sprite region(s). You can now refine boxes, naming, and export settings.`,
      )
    } catch (caught) {
      setError(asErrorMessage(caught))
    } finally {
      setBusyLabel('')
    }
  }

  const rerunDetection = async () => {
    const current = projectRef.current
    if (!current) {
      return
    }

    setError('')
    setBusyLabel('Re-running detection...')
    try {
      const nextProject = await analyzeImage({
        imagePath: current.sourceImagePath,
        settings: current.detectionSettings,
        prompt: current.prompt,
      })
      replaceProject(nextProject, {
        resetHistory: true,
        selection: nextProject.sprites[0] ? [nextProject.sprites[0].id] : [],
      })
      setPreviewUrl(filePathToUrl(current.sourceImagePath))
      setStatus(
        `Detection refreshed with alpha threshold ${current.detectionSettings.alphaThreshold} and minimum area ${current.detectionSettings.minArea}.`,
      )
    } catch (caught) {
      setError(asErrorMessage(caught))
    } finally {
      setBusyLabel('')
    }
  }

  const chooseOutputDirectory = async () => {
    const chosen = await open({
      directory: true,
      multiple: false,
      defaultPath:
        exportSettings.outputDir || project?.sourceImagePath || undefined,
    })
    if (!chosen || Array.isArray(chosen)) {
      return
    }
    setExportSettings((current) => ({ ...current, outputDir: chosen }))
  }

  const runDescriptionGeneration = async (selectedOnly: boolean) => {
    const current = projectRef.current
    if (!current) {
      return
    }

    setError('')
    setBusyLabel('Generating AI descriptions...')
    try {
      const nextProject = await generateDescriptions(current, {
        ...providerConfig,
        spriteIds: selectedOnly ? selectedIds : [],
      })
      replaceProject(nextProject, {
        push: true,
        selection: selectedIds,
      })
      setStatus(
        selectedOnly
          ? `AI descriptions updated for ${selectedIds.length} selected sprite(s).`
          : 'AI descriptions updated for the full sheet.',
      )
    } catch (caught) {
      setError(asErrorMessage(caught))
    } finally {
      setBusyLabel('')
    }
  }

  const runExport = async () => {
    const current = projectRef.current
    if (!current) {
      return
    }
    if (!exportSettings.outputDir) {
      setError('Choose an output directory before exporting.')
      return
    }

    setError('')
    setBusyLabel('Exporting project...')
    try {
      const result = await exportProject(current, exportSettings)
      replaceProject(result.project, {
        push: true,
        selection: selectedIds,
      })
      setStatus(buildExportStatus(result))
    } catch (caught) {
      setError(asErrorMessage(caught))
    } finally {
      setBusyLabel('')
    }
  }

  const handleUndo = () => {
    if (history.index <= 0) {
      return
    }
    const nextIndex = history.index - 1
    const next = history.entries[nextIndex]
    replaceProject(structuredClone(next), { selection: selectedIds })
    setHistory((current) => ({ ...current, index: nextIndex }))
    setStatus('Undid the last project edit.')
  }

  const handleRedo = () => {
    if (history.index >= history.entries.length - 1) {
      return
    }
    const nextIndex = history.index + 1
    const next = history.entries[nextIndex]
    replaceProject(structuredClone(next), { selection: selectedIds })
    setHistory((current) => ({ ...current, index: nextIndex }))
    setStatus('Redid the next project edit.')
  }

  const deleteSelection = () => {
    if (!project || selectedIds.length === 0) {
      return
    }
    const nextSelection = selectedIds[0]
    updateProject(
      (draft) => {
        draft.sprites = draft.sprites.filter(
          (sprite) => !selectedIds.includes(sprite.id),
        )
        return draft
      },
      { push: true, selection: nextSelection ? [] : [] },
    )
    setSelectedIds([])
    setStatus(`Deleted ${selectedIds.length} sprite box(es).`)
  }

  const reorderSprite = (direction: -1 | 1) => {
    if (!project || selectedIds.length !== 1) {
      return
    }
    const targetId = selectedIds[0]
    updateProject(
      (draft) => {
        const currentIndex = draft.sprites.findIndex(
          (sprite) => sprite.id === targetId,
        )
        const nextIndex = clampNumber(
          currentIndex + direction,
          0,
          draft.sprites.length - 1,
        )
        if (currentIndex === nextIndex) {
          return draft
        }
        const [item] = draft.sprites.splice(currentIndex, 1)
        draft.sprites.splice(nextIndex, 0, item)
        return draft
      },
      { push: true, selection: [targetId] },
    )
    setStatus(direction < 0 ? 'Moved sprite up.' : 'Moved sprite down.')
  }

  const beginMove = (spriteId: string, additive: boolean) => {
    if (!project) {
      return
    }
    const selection = additive
      ? toggleSelection(selectedIds, spriteId)
      : selectedIds.includes(spriteId)
        ? selectedIds
        : [spriteId]
    setSelectedIds(selection)
  }

  const handleStagePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!project || !stageRef.current) {
      return
    }
    if (event.button !== 0) {
      return
    }

    const point = getImagePoint(event.clientX, event.clientY, stageRef.current, zoom)
    if (!point) {
      return
    }

    if (tool === 'create') {
      const previewId = `sprite-draft-${draftIdRef.current}`
      draftIdRef.current += 1
      const baseProject = structuredClone(project)
      baseProject.sprites.push(
        createSpriteRecord(
          previewId,
          baseProject.sprites.length + 1,
          {
            x: point.x,
            y: point.y,
            width: 1,
            height: 1,
          },
        ),
      )
      replaceProject(baseProject, { selection: [previewId] })
      setInteraction({
        type: 'create',
        origin: point,
        baseProject: structuredClone(project),
        previewId,
      })
      return
    }

    if (event.target === event.currentTarget) {
      setSelectedIds([])
    }
  }

  const beginDragSelection = (
    event: React.PointerEvent<HTMLButtonElement>,
    spriteId: string,
  ) => {
    event.stopPropagation()
    if (!project || !stageRef.current) {
      return
    }
    const point = getImagePoint(event.clientX, event.clientY, stageRef.current, zoom)
    if (!point) {
      return
    }
    const additive = event.shiftKey
    const selection = additive
      ? toggleSelection(selectedIds, spriteId)
      : selectedIds.includes(spriteId)
        ? selectedIds
        : [spriteId]
    setSelectedIds(selection)
    setInteraction({
      type: 'move',
      origin: point,
      baseProject: structuredClone(project),
      spriteIds: selection,
    })
  }

  const beginResize = (
    event: React.PointerEvent<HTMLButtonElement>,
    spriteId: string,
    handle: ResizeHandle,
  ) => {
    event.stopPropagation()
    if (!project || !stageRef.current) {
      return
    }
    const point = getImagePoint(event.clientX, event.clientY, stageRef.current, zoom)
    if (!point) {
      return
    }
    setSelectedIds([spriteId])
    setInteraction({
      type: 'resize',
      origin: point,
      baseProject: structuredClone(project),
      spriteId,
      handle,
    })
  }

  const applyInteractionMove = useEffectEvent((pointer: { x: number; y: number }) => {
    const currentInteraction = interaction
    if (!currentInteraction) {
      return
    }

    const baseProject = structuredClone(currentInteraction.baseProject)
    if (currentInteraction.type === 'move') {
      const deltaX = Math.round(pointer.x - currentInteraction.origin.x)
      const deltaY = Math.round(pointer.y - currentInteraction.origin.y)
      baseProject.sprites = baseProject.sprites.map((sprite) => {
        if (!currentInteraction.spriteIds.includes(sprite.id)) {
          return sprite
        }
        return {
          ...sprite,
          bbox: clampBoundingBox(
            {
              ...sprite.bbox,
              x: sprite.bbox.x + deltaX,
              y: sprite.bbox.y + deltaY,
            },
            baseProject.imageSize.width,
            baseProject.imageSize.height,
          ),
        }
      })
      replaceProject(baseProject, {
        selection: currentInteraction.spriteIds,
      })
      return
    }

    if (currentInteraction.type === 'resize') {
      const sprite = baseProject.sprites.find(
        (candidate) => candidate.id === currentInteraction.spriteId,
      )
      if (!sprite) {
        return
      }
      sprite.bbox = resizeBoundingBox(
        sprite.bbox,
        currentInteraction.handle,
        currentInteraction.origin,
        pointer,
        baseProject.imageSize.width,
        baseProject.imageSize.height,
      )
      replaceProject(baseProject, {
        selection: [currentInteraction.spriteId],
      })
      return
    }

    const preview = baseProject.sprites.find(
      (sprite) => sprite.id === currentInteraction.previewId,
    )
    if (!preview) {
      return
    }
    preview.bbox = rectFromPoints(currentInteraction.origin, pointer)
    replaceProject(baseProject, {
      selection: [currentInteraction.previewId],
    })
  })

  const finishInteraction = useEffectEvent(() => {
    const currentInteraction = interaction
    if (!currentInteraction) {
      return
    }

    const current = projectRef.current
    if (!current) {
      setInteraction(null)
      return
    }

    if (currentInteraction.type === 'create') {
      const preview = current.sprites.find(
        (sprite) => sprite.id === currentInteraction.previewId,
      )
      if (!preview || preview.bbox.width < 4 || preview.bbox.height < 4) {
        replaceProject(currentInteraction.baseProject, {
          selection: [],
        })
        setInteraction(null)
        setStatus('Ignored a tiny draft box. Drag a bit more to create one.')
        return
      }
      const finalized = structuredClone(current)
      const created = finalized.sprites.find(
        (sprite) => sprite.id === currentInteraction.previewId,
      )
      if (created) {
        created.id = `sprite-${String(finalized.sprites.length).padStart(3, '0')}`
        created.name = `sprite_${String(finalized.sprites.length).padStart(3, '0')}`
      }
      replaceProject(finalized, {
        push: true,
        selection: created ? [created.id] : [],
      })
      setInteraction(null)
      setTool('select')
      setStatus('Created a new sprite box.')
      return
    }

    replaceProject(current, {
      push: true,
      selection:
        currentInteraction.type === 'move'
          ? currentInteraction.spriteIds
          : [currentInteraction.spriteId],
    })
    setInteraction(null)
    setStatus(
      currentInteraction.type === 'move'
        ? 'Moved selected sprite box(es).'
        : 'Resized sprite box.',
    )
  })

  useEffect(() => {
    if (!interaction || !stageRef.current) {
      return
    }
    const stageElement = stageRef.current

    const handleMove = (event: PointerEvent) => {
      const point = getImagePoint(event.clientX, event.clientY, stageElement, zoom)
      if (!point) {
        return
      }
      applyInteractionMove(point)
    }

    const handleUp = () => {
      finishInteraction()
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [interaction, zoom])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">SpriteSplit</p>
          <h1>AI sprite cleanup workbench</h1>
          <p className="subtitle">
            Detect irregularly placed sprites, correct boxes visually, add AI
            descriptions, and export metadata or normalized crops.
          </p>
        </div>
        <div className="topbar-actions">
          <button className="primary" onClick={importImage} type="button">
            Import PNG
          </button>
          <button
            disabled={!project || !!busyLabel}
            onClick={rerunDetection}
            type="button"
          >
            Re-run Detection
          </button>
          <button
            disabled={history.index <= 0 || !!busyLabel}
            onClick={handleUndo}
            type="button"
          >
            Undo
          </button>
          <button
            disabled={history.index >= history.entries.length - 1 || !!busyLabel}
            onClick={handleRedo}
            type="button"
          >
            Redo
          </button>
        </div>
      </header>

      <section className="status-strip">
        <div>
          <strong>Status:</strong> {busyLabel || status}
        </div>
        {project ? (
          <div className="status-meta">
            <span>{project.sourceImageName}</span>
            <span>{project.sprites.length} sprites</span>
            <span>{project.imageSize.width}×{project.imageSize.height}</span>
          </div>
        ) : null}
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <main className="workspace">
        <aside className="control-panel">
          <section className="panel-card">
            <div className="panel-header">
              <h2>Detection</h2>
              <p>Alpha thresholding and connected-component grouping.</p>
            </div>
            <label>
              <span>Alpha threshold</span>
              <input
                disabled={!project}
                max={255}
                min={0}
                type="range"
                value={project?.detectionSettings.alphaThreshold ?? 10}
                onChange={(event) =>
                  updateProject(
                    (draft) => ({
                      ...draft,
                      detectionSettings: {
                        ...draft.detectionSettings,
                        alphaThreshold: Number(event.target.value),
                      },
                    }),
                    { selection: selectedIds },
                  )
                }
              />
              <strong>{project?.detectionSettings.alphaThreshold ?? 10}</strong>
            </label>
            <label>
              <span>Minimum region area</span>
              <input
                disabled={!project}
                min={1}
                step={1}
                type="number"
                value={project?.detectionSettings.minArea ?? 16}
                onChange={(event) =>
                  updateProject(
                    (draft) => ({
                      ...draft,
                      detectionSettings: {
                        ...draft.detectionSettings,
                        minArea: Number(event.target.value),
                      },
                    }),
                    { selection: selectedIds },
                  )
                }
              />
            </label>
            <label>
              <span>Sort mode</span>
              <select
                disabled={!project}
                value={
                  project?.detectionSettings.sortMode ??
                  'top-to-bottom-left-to-right'
                }
                onChange={(event) =>
                  updateProject(
                    (draft) => ({
                      ...draft,
                      detectionSettings: {
                        ...draft.detectionSettings,
                        sortMode: event.target.value as typeof defaultDetectionSettings.sortMode,
                      },
                    }),
                    { selection: selectedIds },
                  )
                }
              >
                <option value="top-to-bottom-left-to-right">
                  Top to bottom, then left to right
                </option>
                <option value="left-to-right-top-to-bottom">
                  Left to right, then top to bottom
                </option>
              </select>
            </label>
            <label className="prompt-field">
              <span>Original generation prompt</span>
              <textarea
                disabled={!project}
                placeholder="Paste the prompt you used to generate this sheet. It will be saved with the project and can guide AI naming."
                rows={5}
                value={project?.prompt ?? ''}
                onChange={(event) =>
                  updateProject(
                    (draft) => ({
                      ...draft,
                      prompt: event.target.value,
                    }),
                    { selection: selectedIds },
                  )
                }
              />
            </label>
          </section>

          <section className="panel-card">
            <div className="panel-header">
              <h2>Canvas Tools</h2>
              <p>Choose a tool, then edit boxes directly on the image.</p>
            </div>
            <div className="segmented">
              <button
                className={tool === 'select' ? 'active' : ''}
                onClick={() => setTool('select')}
                type="button"
              >
                Select
              </button>
              <button
                className={tool === 'create' ? 'active' : ''}
                onClick={() => setTool('create')}
                type="button"
              >
                Create Box
              </button>
            </div>
            <label>
              <span>Zoom</span>
              <input
                max={4}
                min={0.25}
                step={0.05}
                type="range"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
              <strong>{Math.round(zoom * 100)}%</strong>
            </label>
            <div className="tool-grid">
              <button
                disabled={selectedIds.length === 0}
                onClick={deleteSelection}
                type="button"
              >
                Delete
              </button>
              <button
                disabled={selectedIds.length !== 1}
                onClick={() => reorderSprite(-1)}
                type="button"
              >
                Move Up
              </button>
              <button
                disabled={selectedIds.length !== 1}
                onClick={() => reorderSprite(1)}
                type="button"
              >
                Move Down
              </button>
            </div>
          </section>
        </aside>

        <section className="stage-panel">
          <div className="stage-frame">
            {project && previewUrl ? (
              <div
                className={`stage ${tool === 'create' ? 'create-mode' : ''}`}
                ref={stageRef}
                onPointerDown={handleStagePointerDown}
                style={{ width: stageWidth, height: stageHeight }}
              >
                <img
                  alt={project.sourceImageName}
                  className="source-image"
                  draggable={false}
                  src={previewUrl}
                  style={{ width: stageWidth, height: stageHeight }}
                />
                {project.sprites.map((sprite) => {
                  const selected = selectedIds.includes(sprite.id)
                  return (
                    <button
                      key={sprite.id}
                      className={`sprite-box ${selected ? 'selected' : ''}`}
                      onPointerDown={(event) =>
                        beginDragSelection(event, sprite.id)
                      }
                      onClick={(event) => {
                        event.stopPropagation()
                        beginMove(sprite.id, event.shiftKey)
                      }}
                      style={{
                        left: sprite.bbox.x * zoom,
                        top: sprite.bbox.y * zoom,
                        width: sprite.bbox.width * zoom,
                        height: sprite.bbox.height * zoom,
                      }}
                      type="button"
                    >
                      <span className="sprite-index">{sprite.index}</span>
                      {selected ? (
                        <>
                          <button
                            aria-label="Resize north west"
                            className="resize-handle nw"
                            onPointerDown={(event) =>
                              beginResize(event, sprite.id, 'nw')
                            }
                            type="button"
                          />
                          <button
                            aria-label="Resize north east"
                            className="resize-handle ne"
                            onPointerDown={(event) =>
                              beginResize(event, sprite.id, 'ne')
                            }
                            type="button"
                          />
                          <button
                            aria-label="Resize south west"
                            className="resize-handle sw"
                            onPointerDown={(event) =>
                              beginResize(event, sprite.id, 'sw')
                            }
                            type="button"
                          />
                          <button
                            aria-label="Resize south east"
                            className="resize-handle se"
                            onPointerDown={(event) =>
                              beginResize(event, sprite.id, 'se')
                            }
                            type="button"
                          />
                        </>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="empty-stage">
                <h2>Drop in a sprite sheet to start</h2>
                <p>
                  SpriteSplit is tuned for transparent PNG sprite sheets from AI
                  image generation workflows.
                </p>
                <button className="primary" onClick={importImage} type="button">
                  Select PNG
                </button>
              </div>
            )}
          </div>
        </section>

        <aside className="inspector-panel">
          <section className="panel-card tabs-card">
            <div className="tabs">
              <button
                className={sidebarTab === 'inspect' ? 'active' : ''}
                onClick={() => setSidebarTab('inspect')}
                type="button"
              >
                Inspect
              </button>
              <button
                className={sidebarTab === 'ai' ? 'active' : ''}
                onClick={() => setSidebarTab('ai')}
                type="button"
              >
                AI
              </button>
              <button
                className={sidebarTab === 'export' ? 'active' : ''}
                onClick={() => setSidebarTab('export')}
                type="button"
              >
                Export
              </button>
            </div>

            {sidebarTab === 'inspect' ? (
              <>
                <div className="panel-header">
                  <h2>Sprite Inspector</h2>
                  <p>
                    Select a single sprite to edit fields, or shift-click for
                    multi-select on the canvas or list.
                  </p>
                </div>
                {activeSprite ? (
                  <div className="inspector-fields">
                    <label>
                      <span>Name</span>
                      <input
                        type="text"
                        value={activeSprite.name}
                        onChange={(event) =>
                          updateSpriteField(
                            activeSprite.id,
                            'name',
                            event.target.value,
                            updateProject,
                          )
                        }
                      />
                    </label>
                    <label>
                      <span>Group</span>
                      <input
                        type="text"
                        value={activeSprite.group}
                        onChange={(event) =>
                          updateSpriteField(
                            activeSprite.id,
                            'group',
                            event.target.value,
                            updateProject,
                          )
                        }
                      />
                    </label>
                    <label>
                      <span>Tags</span>
                      <input
                        type="text"
                        value={activeSprite.tags.join(', ')}
                        onChange={(event) =>
                          updateSpriteField(
                            activeSprite.id,
                            'tags',
                            splitTags(event.target.value),
                            updateProject,
                          )
                        }
                      />
                    </label>
                    <label>
                      <span>Description</span>
                      <textarea
                        rows={4}
                        value={activeSprite.description}
                        onChange={(event) =>
                          updateSpriteField(
                            activeSprite.id,
                            'description',
                            event.target.value,
                            updateProject,
                          )
                        }
                      />
                    </label>
                    <label>
                      <span>AI Description</span>
                      <textarea
                        rows={4}
                        value={activeSprite.aiDescription}
                        readOnly
                      />
                    </label>
                    <div className="bbox-grid">
                      <Metric label="X" value={activeSprite.bbox.x} />
                      <Metric label="Y" value={activeSprite.bbox.y} />
                      <Metric label="W" value={activeSprite.bbox.width} />
                      <Metric label="H" value={activeSprite.bbox.height} />
                    </div>
                  </div>
                ) : (
                  <div className="empty-message">
                    {selectedIds.length > 1
                      ? `${selectedIds.length} sprites selected. Use the canvas tools or the list below.`
                      : 'Select a sprite box to inspect or edit it.'}
                  </div>
                )}

                <div className="sprite-list">
                  {project?.sprites.map((sprite) => {
                    const selected = selectedIds.includes(sprite.id)
                    return (
                      <button
                        className={`sprite-row ${selected ? 'selected' : ''}`}
                        key={sprite.id}
                        onClick={(event) =>
                          setSelectedIds(
                            event.shiftKey
                              ? toggleSelection(selectedIds, sprite.id)
                              : [sprite.id],
                          )
                        }
                        type="button"
                      >
                        <span className="sprite-row-index">{sprite.index}</span>
                        <span className="sprite-row-copy">
                          <strong>{sprite.name || `sprite_${sprite.index}`}</strong>
                          <small>
                            {sprite.bbox.width}×{sprite.bbox.height} at{' '}
                            {sprite.bbox.x}, {sprite.bbox.y}
                          </small>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : null}

            {sidebarTab === 'ai' ? (
              <>
                <div className="panel-header">
                  <h2>AI Descriptions</h2>
                  <p>
                    Use an OpenAI-compatible vision endpoint. Descriptions are
                    cached by image hash, bbox, prompt, and model settings.
                  </p>
                </div>
                <label className="inline-toggle">
                  <input
                    checked={providerConfig.enabled}
                    onChange={(event) =>
                      setProviderConfig((current) => ({
                        ...current,
                        enabled: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>Enable AI provider</span>
                </label>
                <label>
                  <span>Base URL</span>
                  <input
                    type="text"
                    value={providerConfig.baseUrl}
                    onChange={(event) =>
                      setProviderConfig((current) => ({
                        ...current,
                        baseUrl: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>API key</span>
                  <input
                    type="password"
                    value={providerConfig.apiKey}
                    onChange={(event) =>
                      setProviderConfig((current) => ({
                        ...current,
                        apiKey: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Model</span>
                  <input
                    type="text"
                    value={providerConfig.model}
                    onChange={(event) =>
                      setProviderConfig((current) => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Sheet prompt</span>
                  <textarea
                    rows={4}
                    value={providerConfig.sheetPrompt}
                    onChange={(event) =>
                      setProviderConfig((current) => ({
                        ...current,
                        sheetPrompt: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Sprite prompt</span>
                  <textarea
                    rows={4}
                    value={providerConfig.spritePrompt}
                    onChange={(event) =>
                      setProviderConfig((current) => ({
                        ...current,
                        spritePrompt: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="tool-grid">
                  <button
                    disabled={!project || !!busyLabel}
                    onClick={() => runDescriptionGeneration(false)}
                    type="button"
                  >
                    Describe All
                  </button>
                  <button
                    disabled={!project || selectedIds.length === 0 || !!busyLabel}
                    onClick={() => runDescriptionGeneration(true)}
                    type="button"
                  >
                    Describe Selected
                  </button>
                </div>
                {project?.sheetContext ? (
                  <div className="context-box">
                    <strong>Sheet context</strong>
                    <p>{project.sheetContext}</p>
                  </div>
                ) : null}
              </>
            ) : null}

            {sidebarTab === 'export' ? (
              <>
                <div className="panel-header">
                  <h2>Export</h2>
                  <p>
                    Export metadata only, or metadata plus normalized crops for
                    downstream game workflows.
                  </p>
                </div>
                <label>
                  <span>Output directory</span>
                  <div className="path-row">
                    <input readOnly type="text" value={exportSettings.outputDir} />
                    <button onClick={chooseOutputDirectory} type="button">
                      Browse
                    </button>
                  </div>
                </label>
                <label className="inline-toggle">
                  <input
                    checked={exportSettings.exportCrops}
                    onChange={(event) =>
                      setExportSettings((current) => ({
                        ...current,
                        exportCrops: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>Export cropped PNG sprites</span>
                </label>
                <label className="inline-toggle">
                  <input
                    checked={exportSettings.normalizeCanvas}
                    onChange={(event) =>
                      setExportSettings((current) => ({
                        ...current,
                        normalizeCanvas: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>Center crops on a uniform canvas</span>
                </label>
                <div className="two-col">
                  <label>
                    <span>Canvas width</span>
                    <input
                      min={0}
                      type="number"
                      value={exportSettings.canvasWidth}
                      onChange={(event) =>
                        setExportSettings((current) => ({
                          ...current,
                          canvasWidth: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Canvas height</span>
                    <input
                      min={0}
                      type="number"
                      value={exportSettings.canvasHeight}
                      onChange={(event) =>
                        setExportSettings((current) => ({
                          ...current,
                          canvasHeight: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                </div>
                <label className="inline-toggle">
                  <input
                    checked={exportSettings.includeJson}
                    onChange={(event) =>
                      setExportSettings((current) => ({
                        ...current,
                        includeJson: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>Write JSON manifest</span>
                </label>
                <label className="inline-toggle">
                  <input
                    checked={exportSettings.includeCsv}
                    onChange={(event) =>
                      setExportSettings((current) => ({
                        ...current,
                        includeCsv: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>Write CSV summary</span>
                </label>
                <button
                  className="primary"
                  disabled={!project || !!busyLabel}
                  onClick={runExport}
                  type="button"
                >
                  Export Project
                </button>
              </>
            ) : null}
          </section>

          {project?.warnings?.length ? (
            <section className="panel-card warnings-card">
              <div className="panel-header">
                <h2>Warnings</h2>
                <p>Non-blocking issues and skipped steps are recorded here.</p>
              </div>
              <ul className="warning-list">
                {project.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </main>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{Math.round(value)}</strong>
    </div>
  )
}

function normalizeProject(project: ProjectDocument): ProjectDocument {
  project.sprites = project.sprites.map((sprite, index) => {
    const bbox = normalizeRect(sprite.bbox)
    return {
      ...sprite,
      index: index + 1,
      bbox,
      center: {
        x: roundToTwo(bbox.x + bbox.width / 2),
        y: roundToTwo(bbox.y + bbox.height / 2),
      },
      area: bbox.width * bbox.height,
      tags: Array.isArray(sprite.tags) ? sprite.tags : [],
    }
  })
  return project
}

function createSpriteRecord(
  id: string,
  index: number,
  bbox: BoundingBox,
): SpriteRecord {
  const normalized = normalizeRect(bbox)
  return {
    id,
    index,
    bbox: normalized,
    center: {
      x: roundToTwo(normalized.x + normalized.width / 2),
      y: roundToTwo(normalized.y + normalized.height / 2),
    },
    area: normalized.width * normalized.height,
    name: `sprite_${String(index).padStart(3, '0')}`,
    description: '',
    aiDescription: '',
    tags: [],
    group: '',
    cropPath: '',
  }
}

function buildExportStatus(result: ExportResult) {
  const parts = []
  if (result.manifestPath) {
    parts.push('JSON manifest')
  }
  if (result.csvPath) {
    parts.push('CSV summary')
  }
  if (result.exportedSprites.length) {
    parts.push(`${result.exportedSprites.length} crop(s)`)
  }
  return `Exported ${parts.join(', ')} to ${result.manifestPath || result.csvPath || result.cropDirectory}.`
}

function updateSpriteField<K extends keyof SpriteRecord>(
  spriteId: string,
  field: K,
  value: SpriteRecord[K],
  updater: (
    update: (draft: ProjectDocument) => ProjectDocument,
    options?: { push?: boolean; selection?: string[] },
  ) => void,
) {
  updater(
    (draft) => {
      const sprite = draft.sprites.find((candidate) => candidate.id === spriteId)
      if (!sprite) {
        return draft
      }
      sprite[field] = value
      return draft
    },
    { selection: [spriteId] },
  )
}

function splitTags(value: string) {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function toggleSelection(selectedIds: string[], spriteId: string) {
  return selectedIds.includes(spriteId)
    ? selectedIds.filter((current) => current !== spriteId)
    : [...selectedIds, spriteId]
}

function deriveDefaultExportDir(imagePath: string) {
  const normalized = imagePath.replace(/\//g, '\\')
  const lastSlash = normalized.lastIndexOf('\\')
  if (lastSlash === -1) {
    return ''
  }
  return `${normalized.slice(0, lastSlash)}\\spritesplit-export`
}

function asErrorMessage(error: unknown) {
  if (typeof error === 'string') {
    return error
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message)
  }
  return 'Something went wrong.'
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function clampBoundingBox(
  bbox: BoundingBox,
  imageWidth: number,
  imageHeight: number,
) {
  const normalized = normalizeRect(bbox)
  return {
    x: clampNumber(normalized.x, 0, Math.max(imageWidth - normalized.width, 0)),
    y: clampNumber(
      normalized.y,
      0,
      Math.max(imageHeight - normalized.height, 0),
    ),
    width: Math.min(normalized.width, imageWidth),
    height: Math.min(normalized.height, imageHeight),
  }
}

function normalizeRect(rect: BoundingBox): BoundingBox {
  const x2 = rect.x + rect.width
  const y2 = rect.y + rect.height
  return {
    x: Math.round(Math.min(rect.x, x2)),
    y: Math.round(Math.min(rect.y, y2)),
    width: Math.max(1, Math.round(Math.abs(rect.width))),
    height: Math.max(1, Math.round(Math.abs(rect.height))),
  }
}

function getImagePoint(
  clientX: number,
  clientY: number,
  stage: HTMLDivElement,
  zoom: number,
) {
  const bounds = stage.getBoundingClientRect()
  const x = (clientX - bounds.left) / zoom
  const y = (clientY - bounds.top) / zoom
  if (Number.isNaN(x) || Number.isNaN(y)) {
    return null
  }
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
  }
}

function resizeBoundingBox(
  original: BoundingBox,
  handle: ResizeHandle,
  origin: { x: number; y: number },
  pointer: { x: number; y: number },
  imageWidth: number,
  imageHeight: number,
) {
  const deltaX = pointer.x - origin.x
  const deltaY = pointer.y - origin.y
  const next = { ...original }

  if (handle === 'nw' || handle === 'sw') {
    next.x = original.x + deltaX
    next.width = original.width - deltaX
  }
  if (handle === 'ne' || handle === 'se') {
    next.width = original.width + deltaX
  }
  if (handle === 'nw' || handle === 'ne') {
    next.y = original.y + deltaY
    next.height = original.height - deltaY
  }
  if (handle === 'sw' || handle === 'se') {
    next.height = original.height + deltaY
  }

  return clampBoundingBox(normalizeRect(next), imageWidth, imageHeight)
}

function rectFromPoints(
  origin: { x: number; y: number },
  pointer: { x: number; y: number },
) {
  return normalizeRect({
    x: origin.x,
    y: origin.y,
    width: pointer.x - origin.x,
    height: pointer.y - origin.y,
  })
}

export default App
