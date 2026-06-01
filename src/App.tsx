import {
  startTransition,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import type { CSSProperties } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BoxSelect,
  Download,
  FolderOpen,
  Languages,
  Maximize2,
  MousePointer2,
  PlusSquare,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
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
type Language = 'en' | 'zh'
type BusyState = '' | 'analyzing' | 'rerunning' | 'describing' | 'exporting'

const ZOOM_MIN = 0.25
const ZOOM_MAX = 4
const ZOOM_STEP = 0.05
const LEFT_RAIL_STORAGE_KEY = 'spritesplit-left-rail-width'
const RIGHT_RAIL_STORAGE_KEY = 'spritesplit-right-rail-width'
const LEFT_RAIL_DEFAULT = 204
const RIGHT_RAIL_DEFAULT = 360
const LEFT_RAIL_MIN = 170
const LEFT_RAIL_MAX = 360
const RIGHT_RAIL_MIN = 300
const RIGHT_RAIL_MAX = 560

type StatusState =
  | { key: 'idle' }
  | { key: 'runningDetection' }
  | { key: 'detected'; count: number }
  | { key: 'refreshed'; alphaThreshold: number; minArea: number }
  | { key: 'describedSelected'; count: number }
  | { key: 'describedAll' }
  | { key: 'undo' }
  | { key: 'redo' }
  | { key: 'deleted'; count: number }
  | { key: 'moveUp' }
  | { key: 'moveDown' }
  | { key: 'ignoredTinyDraft' }
  | { key: 'createdBox' }
  | { key: 'movedBoxes' }
  | { key: 'resizedBox' }
  | { key: 'exported'; result: ExportResult }

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
    'Name this sprite for game development asset lookup, then describe it briefly.',
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

const LANGUAGE_STORAGE_KEY = 'spritesplit-language'

const UI_TEXT = {
  en: {
    pageTitle: 'SpriteSplit',
    heroTitle: 'AI sprite cleanup workbench',
    heroSubtitle:
      'Detect irregularly placed sprites, correct boxes visually, add AI descriptions, and export metadata or normalized crops.',
    languageLabel: 'Language',
    languageEnglish: 'English',
    languageChinese: '中文',
    importPng: 'Import PNG',
    selectPng: 'Select PNG',
    rerunDetection: 'Re-run Detection',
    undo: 'Undo',
    redo: 'Redo',
    statusLabel: 'Status:',
    spritesCount: (count: number) => `${count} sprites`,
    selectionCount: (count: number) => `${count} selected`,
    historyState: (index: number, total: number) => `History ${index}/${total}`,
    detectionTitle: 'Detection',
    detectionDescription: 'Alpha thresholding and connected-component grouping.',
    alphaThreshold: 'Alpha threshold',
    minRegionArea: 'Minimum region area',
    sortMode: 'Sort mode',
    sortTopToBottom: 'Top to bottom, then left to right',
    sortLeftToRight: 'Left to right, then top to bottom',
    originalPrompt: 'Original generation prompt',
    originalPromptPlaceholder:
      'Paste the prompt you used to generate this sheet. It will be saved with the project and can guide AI naming.',
    canvasToolsTitle: 'Canvas Tools',
    canvasToolsDescription: 'Choose a tool, then edit boxes directly on the image.',
    selectTool: 'Select',
    createBox: 'Create Box',
    zoom: 'Zoom',
    fitToView: 'Fit',
    actualSize: '100%',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    delete: 'Delete',
    moveUp: 'Move Up',
    moveDown: 'Move Down',
    resizeNorthWest: 'Resize north west',
    resizeNorthEast: 'Resize north east',
    resizeSouthWest: 'Resize south west',
    resizeSouthEast: 'Resize south east',
    emptyStageTitle: 'Drop in a sprite sheet to start',
    emptyStageDescription:
      'SpriteSplit is tuned for transparent PNG sprite sheets from AI image generation workflows.',
    inspect: 'Inspect',
    ai: 'AI',
    export: 'Export',
    inspectorTitle: 'Sprite Inspector',
    inspectorDescription:
      'Select a single sprite to edit fields, or shift-click for multi-select on the canvas or list.',
    name: 'Name',
    group: 'Group',
    tags: 'Tags',
    description: 'Description',
    aiDescription: 'AI Description',
    selectedSpritesMessage: (count: number) =>
      `${count} sprites selected. Use the canvas tools or the list below.`,
    selectSpriteHint: 'Select a sprite box to inspect or edit it.',
    spriteLocation: (width: number, height: number, x: number, y: number) =>
      `${width}×${height} at ${x}, ${y}`,
    aiTitle: 'AI Naming',
    aiDescriptionText:
      'Use an OpenAI-compatible vision endpoint to rename each sprite with a developer-friendly asset name and keep a short description.',
    enableAiProvider: 'Enable AI provider',
    baseUrl: 'Base URL',
    apiKey: 'API key',
    model: 'Model',
    sheetPrompt: 'Sheet prompt',
    spritePrompt: 'Sprite prompt',
    describeAll: 'Name All',
    describeSelected: 'Name Selected',
    sheetContext: 'Sheet context',
    exportTitle: 'Export',
    exportDescription:
      'Export metadata only, or metadata plus normalized crops for downstream game workflows.',
    outputDirectory: 'Output directory',
    browse: 'Browse',
    exportCrops: 'Export cropped PNG sprites',
    normalizeCanvas: 'Center crops on a uniform canvas',
    canvasWidth: 'Canvas width',
    canvasHeight: 'Canvas height',
    writeJson: 'Write JSON manifest',
    writeCsv: 'Write CSV summary',
    exportProject: 'Export Project',
    warningsTitle: 'Warnings',
    warningsDescription: 'Non-blocking issues and skipped steps are recorded here.',
    pngSpriteSheets: 'PNG Sprite Sheets',
    runtimeRequired: 'The desktop runtime is required for file import.',
    chooseOutputDirFirst: 'Choose an output directory before exporting.',
    fallbackError: 'Something went wrong.',
    exportJsonManifest: 'JSON manifest',
    exportCsvSummary: 'CSV summary',
    exportCropsCount: (count: number) => `${count} crop(s)`,
    exportStatus: (parts: string, target: string) => `Exported ${parts} to ${target}.`,
    statusIdle: 'Import a PNG sprite image to begin detection and editing.',
    statusRunningDetection: 'Running alpha-based detection...',
    statusDetected: (count: number) =>
      `Detected ${count} sprite region(s). You can now refine boxes, naming, and export settings.`,
    statusRefreshed: (alphaThreshold: number, minArea: number) =>
      `Detection refreshed with alpha threshold ${alphaThreshold} and minimum area ${minArea}.`,
    statusDescribedSelected: (count: number) =>
      `AI names updated for ${count} selected sprite(s).`,
    statusDescribedAll: 'AI names updated for the full sheet.',
    statusUndo: 'Undid the last project edit.',
    statusRedo: 'Redid the next project edit.',
    statusDeleted: (count: number) => `Deleted ${count} sprite box(es).`,
    statusMoveUp: 'Moved sprite up.',
    statusMoveDown: 'Moved sprite down.',
    statusIgnoredTinyDraft: 'Ignored a tiny draft box. Drag a bit more to create one.',
    statusCreatedBox: 'Created a new sprite box.',
    statusMovedBoxes: 'Moved selected sprite box(es).',
    statusResizedBox: 'Resized sprite box.',
    busyAnalyzing: 'Analyzing sprite sheet...',
    busyRerunning: 'Re-running detection...',
    busyDescribing: 'Generating AI names...',
    busyExporting: 'Exporting project...',
  },
  zh: {
    pageTitle: 'SpriteSplit',
    heroTitle: 'AI 切图表清理工作台',
    heroSubtitle:
      '检测摆放不规则的切图，直接在画布上修正框选，补充 AI 描述，并导出元数据或统一尺寸裁剪图。',
    languageLabel: '语言',
    languageEnglish: 'English',
    languageChinese: '中文',
    importPng: '导入 PNG',
    selectPng: '选择 PNG',
    rerunDetection: '重新检测',
    undo: '撤销',
    redo: '重做',
    statusLabel: '状态：',
    spritesCount: (count: number) => `${count} 张切图`,
    selectionCount: (count: number) => `已选 ${count} 个`,
    historyState: (index: number, total: number) => `历史记录 ${index}/${total}`,
    detectionTitle: '检测',
    detectionDescription: '基于 Alpha 阈值与连通区域分组进行检测。',
    alphaThreshold: 'Alpha 阈值',
    minRegionArea: '最小区域面积',
    sortMode: '排序方式',
    sortTopToBottom: '先从上到下，再从左到右',
    sortLeftToRight: '先从左到右，再从上到下',
    originalPrompt: '原始生成提示词',
    originalPromptPlaceholder:
      '粘贴你生成这张切图表时使用的提示词。它会随项目保存，也可以辅助 AI 命名。',
    canvasToolsTitle: '画布工具',
    canvasToolsDescription: '选择一个工具后，直接在图片上编辑框选区域。',
    selectTool: '选择',
    createBox: '创建框选',
    zoom: '缩放',
    fitToView: '适应窗口',
    actualSize: '100%',
    zoomIn: '放大',
    zoomOut: '缩小',
    delete: '删除',
    moveUp: '上移',
    moveDown: '下移',
    resizeNorthWest: '向左上调整大小',
    resizeNorthEast: '向右上调整大小',
    resizeSouthWest: '向左下调整大小',
    resizeSouthEast: '向右下调整大小',
    emptyStageTitle: '导入切图表后开始',
    emptyStageDescription: 'SpriteSplit 适合处理带透明通道的 PNG 切图表，尤其是 AI 生成的图集。',
    inspect: '检查',
    ai: 'AI',
    export: '导出',
    inspectorTitle: '切图检查器',
    inspectorDescription: '选中单个切图可编辑字段；在画布或列表中按住 Shift 可多选。',
    name: '名称',
    group: '分组',
    tags: '标签',
    description: '描述',
    aiDescription: 'AI 描述',
    selectedSpritesMessage: (count: number) =>
      `已选择 ${count} 张切图。可使用画布工具或下方列表继续操作。`,
    selectSpriteHint: '选择一个切图框即可查看或编辑。',
    spriteLocation: (width: number, height: number, x: number, y: number) =>
      `${width}×${height}，位置 ${x}, ${y}`,
    aiTitle: 'AI 命名',
    aiDescriptionText:
      '使用兼容 OpenAI 的视觉接口，为每张切图生成方便开发检索的资源名，并保留简短描述。',
    enableAiProvider: '启用 AI 提供方',
    baseUrl: 'Base URL',
    apiKey: 'API Key',
    model: '模型',
    sheetPrompt: '整张图提示词',
    spritePrompt: '单张切图提示词',
    describeAll: '命名全部',
    describeSelected: '命名选中项',
    sheetContext: '整张图上下文',
    exportTitle: '导出',
    exportDescription: '可只导出元数据，或连同统一尺寸裁剪图一起导出，用于后续游戏资源流程。',
    outputDirectory: '输出目录',
    browse: '浏览',
    exportCrops: '导出裁剪后的 PNG 切图',
    normalizeCanvas: '将裁剪图居中到统一画布',
    canvasWidth: '画布宽度',
    canvasHeight: '画布高度',
    writeJson: '写入 JSON 清单',
    writeCsv: '写入 CSV 摘要',
    exportProject: '导出项目',
    warningsTitle: '警告',
    warningsDescription: '这里会记录不阻塞流程的问题和被跳过的步骤。',
    pngSpriteSheets: 'PNG 切图表',
    runtimeRequired: '导入文件需要桌面运行时环境。',
    chooseOutputDirFirst: '导出前请先选择输出目录。',
    fallbackError: '发生了一些问题。',
    exportJsonManifest: 'JSON 清单',
    exportCsvSummary: 'CSV 摘要',
    exportCropsCount: (count: number) => `${count} 个裁剪图`,
    exportStatus: (parts: string, target: string) => `已导出 ${parts} 到 ${target}。`,
    statusIdle: '导入一张 PNG 切图表后即可开始检测和编辑。',
    statusRunningDetection: '正在执行基于 Alpha 的检测...',
    statusDetected: (count: number) =>
      `已检测到 ${count} 个切图区域。现在可以继续微调框选、命名和导出设置。`,
    statusRefreshed: (alphaThreshold: number, minArea: number) =>
      `检测已刷新，当前 Alpha 阈值为 ${alphaThreshold}，最小面积为 ${minArea}。`,
    statusDescribedSelected: (count: number) =>
      `已为 ${count} 张选中切图更新 AI 命名。`,
    statusDescribedAll: '已为整张切图表更新 AI 命名。',
    statusUndo: '已撤销上一次项目编辑。',
    statusRedo: '已重做下一步项目编辑。',
    statusDeleted: (count: number) => `已删除 ${count} 个切图框。`,
    statusMoveUp: '已将切图上移。',
    statusMoveDown: '已将切图下移。',
    statusIgnoredTinyDraft: '已忽略过小的草稿框。拖拽更大一点即可创建。',
    statusCreatedBox: '已创建新的切图框。',
    statusMovedBoxes: '已移动选中的切图框。',
    statusResizedBox: '已调整切图框大小。',
    busyAnalyzing: '正在分析切图表...',
    busyRerunning: '正在重新检测...',
    busyDescribing: '正在生成 AI 命名...',
    busyExporting: '正在导出项目...',
  },
} as const

function getStoredLanguage(): Language {
  if (typeof window === 'undefined') {
    return 'en'
  }
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return stored === 'zh' ? 'zh' : 'en'
}

function getStoredWidth(key: string, fallback: number, min: number, max: number) {
  if (typeof window === 'undefined') {
    return fallback
  }
  const stored = Number(window.localStorage.getItem(key))
  return Number.isFinite(stored) ? clampNumber(stored, min, max) : fallback
}

function App() {
  const [language, setLanguage] = useState<Language>(getStoredLanguage)
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
  const [status, setStatus] = useState<StatusState>({ key: 'idle' })
  const [error, setError] = useState('')
  const [busyState, setBusyState] = useState<BusyState>('')
  const [fitRequestKey, setFitRequestKey] = useState(0)
  const [leftRailWidth, setLeftRailWidth] = useState(() =>
    getStoredWidth(
      LEFT_RAIL_STORAGE_KEY,
      LEFT_RAIL_DEFAULT,
      LEFT_RAIL_MIN,
      LEFT_RAIL_MAX,
    ),
  )
  const [rightRailWidth, setRightRailWidth] = useState(() =>
    getStoredWidth(
      RIGHT_RAIL_STORAGE_KEY,
      RIGHT_RAIL_DEFAULT,
      RIGHT_RAIL_MIN,
      RIGHT_RAIL_MAX,
    ),
  )

  const stageRef = useRef<HTMLDivElement | null>(null)
  const stageFrameRef = useRef<HTMLDivElement | null>(null)
  const projectRef = useRef<ProjectDocument | null>(null)
  const draftIdRef = useRef(1)
  const ui = UI_TEXT[language]
  const busyLabel = formatBusyLabel(busyState, ui)
  const statusLabel = formatStatus(status, ui)

  useEffect(() => {
    projectRef.current = project
  }, [project])

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
    document.title = ui.pageTitle
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  }, [language, ui.pageTitle])

  const activeSprite =
    selectedIds.length === 1
      ? project?.sprites.find((sprite) => sprite.id === selectedIds[0]) ?? null
      : null

  const stageWidth = project ? project.imageSize.width * zoom : 0
  const stageHeight = project ? project.imageSize.height * zoom : 0

  const fitStageToViewport = useCallback(() => {
    const current = projectRef.current
    const frame = stageFrameRef.current
    if (!current || !frame) {
      return
    }
    setZoom(calculateFitZoom(current.imageSize.width, current.imageSize.height, frame))
  }, [])

  const beginSidebarResize = (
    side: 'left' | 'right',
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = side === 'left' ? leftRailWidth : rightRailWidth

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX
      const nextWidth =
        side === 'left' ? startWidth + delta : startWidth - delta
      if (side === 'left') {
        setLeftRailWidth(clampNumber(nextWidth, LEFT_RAIL_MIN, LEFT_RAIL_MAX))
      } else {
        setRightRailWidth(clampNumber(nextWidth, RIGHT_RAIL_MIN, RIGHT_RAIL_MAX))
      }
    }

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      document.body.classList.remove('is-resizing-sidebar')
    }

    document.body.classList.add('is-resizing-sidebar')
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp, { once: true })
  }

  useEffect(() => {
    window.localStorage.setItem(LEFT_RAIL_STORAGE_KEY, String(leftRailWidth))
  }, [leftRailWidth])

  useEffect(() => {
    window.localStorage.setItem(RIGHT_RAIL_STORAGE_KEY, String(rightRailWidth))
  }, [rightRailWidth])

  const updateZoom = (nextZoom: number) => {
    setZoom(clampZoom(nextZoom))
  }

  const zoomIn = () => {
    updateZoom(zoom + ZOOM_STEP)
  }

  const zoomOut = () => {
    updateZoom(zoom - ZOOM_STEP)
  }

  const resetZoom = () => {
    updateZoom(1)
  }

  useEffect(() => {
    if (!project || fitRequestKey === 0) {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      fitStageToViewport()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [fitRequestKey, fitStageToViewport, project])

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
      setError(ui.runtimeRequired)
      return
    }

    const chosen = await open({
      multiple: false,
      filters: [
        {
          name: ui.pngSpriteSheets,
          extensions: ['png'],
        },
      ],
    })

    if (!chosen || Array.isArray(chosen)) {
      return
    }

    setError('')
    setBusyState('analyzing')
    setStatus({ key: 'runningDetection' })

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
      setFitRequestKey((current) => current + 1)
      setExportSettings((current) => ({
        ...current,
        outputDir: current.outputDir || deriveDefaultExportDir(chosen),
      }))
      setStatus({ key: 'detected', count: nextProject.sprites.length })
    } catch (caught) {
      setError(asErrorMessage(caught, ui.fallbackError))
    } finally {
      setBusyState('')
    }
  }

  const rerunDetection = async () => {
    const current = projectRef.current
    if (!current) {
      return
    }

    setError('')
    setBusyState('rerunning')
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
      setFitRequestKey((currentKey) => currentKey + 1)
      setStatus({
        key: 'refreshed',
        alphaThreshold: current.detectionSettings.alphaThreshold,
        minArea: current.detectionSettings.minArea,
      })
    } catch (caught) {
      setError(asErrorMessage(caught, ui.fallbackError))
    } finally {
      setBusyState('')
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
    setBusyState('describing')
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
          ? { key: 'describedSelected', count: selectedIds.length }
          : { key: 'describedAll' },
      )
    } catch (caught) {
      setError(asErrorMessage(caught, ui.fallbackError))
    } finally {
      setBusyState('')
    }
  }

  const runExport = async () => {
    const current = projectRef.current
    if (!current) {
      return
    }
    if (!exportSettings.outputDir) {
      setError(ui.chooseOutputDirFirst)
      return
    }

    setError('')
    setBusyState('exporting')
    try {
      const result = await exportProject(current, exportSettings)
      replaceProject(result.project, {
        push: true,
        selection: selectedIds,
      })
      setStatus({ key: 'exported', result })
    } catch (caught) {
      setError(asErrorMessage(caught, ui.fallbackError))
    } finally {
      setBusyState('')
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
    setStatus({ key: 'undo' })
  }

  const handleRedo = () => {
    if (history.index >= history.entries.length - 1) {
      return
    }
    const nextIndex = history.index + 1
    const next = history.entries[nextIndex]
    replaceProject(structuredClone(next), { selection: selectedIds })
    setHistory((current) => ({ ...current, index: nextIndex }))
    setStatus({ key: 'redo' })
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
    setStatus({ key: 'deleted', count: selectedIds.length })
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
    setStatus({ key: direction < 0 ? 'moveUp' : 'moveDown' })
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
    event: React.PointerEvent<HTMLElement>,
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
        setStatus({ key: 'ignoredTinyDraft' })
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
      setStatus({ key: 'createdBox' })
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
      currentInteraction.type === 'move' ? { key: 'movedBoxes' } : { key: 'resizedBox' },
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
      <AppToolbar
        busyLabel={busyLabel}
        handleRedo={handleRedo}
        handleUndo={handleUndo}
        history={history}
        importImage={importImage}
        language={language}
        project={project}
        rerunDetection={rerunDetection}
        setLanguage={setLanguage}
        statusLabel={statusLabel}
        ui={ui}
      />

      {error ? <div className="error-banner">{error}</div> : null}

      <main
        className="app-main"
        style={{
          '--left-rail-width': `${leftRailWidth}px`,
          '--right-rail-width': `${rightRailWidth}px`,
        } as CSSProperties}
      >
        <ToolRail
          deleteSelection={deleteSelection}
          fitStageToViewport={fitStageToViewport}
          project={project}
          reorderSprite={reorderSprite}
          resetZoom={resetZoom}
          selectedIds={selectedIds}
          setTool={setTool}
          setZoom={updateZoom}
          tool={tool}
          ui={ui}
          updateProject={updateProject}
          zoomIn={zoomIn}
          zoomOut={zoomOut}
          zoom={zoom}
        />

        <div
          aria-label="Resize left toolbar"
          className="sidebar-resizer"
          onPointerDown={(event) => beginSidebarResize('left', event)}
          role="separator"
          tabIndex={0}
        />

        <StageWorkspace
          beginDragSelection={beginDragSelection}
          beginMove={beginMove}
          beginResize={beginResize}
          handleStagePointerDown={handleStagePointerDown}
          importImage={importImage}
          previewUrl={previewUrl}
          project={project}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          setTool={setTool}
          stageFrameRef={stageFrameRef}
          stageHeight={stageHeight}
          stageRef={stageRef}
          stageWidth={stageWidth}
          statusLabel={statusLabel}
          tool={tool}
          ui={ui}
          zoom={zoom}
        />

        <div
          aria-label="Resize inspector panel"
          className="sidebar-resizer"
          onPointerDown={(event) => beginSidebarResize('right', event)}
          role="separator"
          tabIndex={0}
        />

        <InspectorPanel
          activeSprite={activeSprite}
          busyState={busyState}
          chooseOutputDirectory={chooseOutputDirectory}
          exportSettings={exportSettings}
          project={project}
          providerConfig={providerConfig}
          runDescriptionGeneration={runDescriptionGeneration}
          runExport={runExport}
          selectedIds={selectedIds}
          setExportSettings={setExportSettings}
          setProviderConfig={setProviderConfig}
          setSelectedIds={setSelectedIds}
          setSidebarTab={setSidebarTab}
          sidebarTab={sidebarTab}
          ui={ui}
          updateProject={updateProject}
        />
      </main>
    </div>
  )
}

function AppToolbar({
  busyLabel,
  handleRedo,
  handleUndo,
  history,
  importImage,
  language,
  project,
  rerunDetection,
  setLanguage,
  statusLabel,
  ui,
}: {
  busyLabel: string
  handleRedo: () => void
  handleUndo: () => void
  history: { entries: ProjectDocument[]; index: number }
  importImage: () => void
  language: Language
  project: ProjectDocument | null
  rerunDetection: () => void
  setLanguage: (language: Language) => void
  statusLabel: string
  ui: (typeof UI_TEXT)[Language]
}) {
  const historyIndex = history.index >= 0 ? history.index + 1 : 0
  const historyTotal = Math.max(history.entries.length, 0)

  return (
    <header className="app-toolbar">
      <div className="toolbar-section brand-section">
        <div className="brand-mark">SS</div>
        <div className="brand-copy">
          <h1>{ui.pageTitle}</h1>
        </div>
      </div>

      <div className="toolbar-section toolbar-meta">
        <div className="toolbar-pills">
          {project ? (
            <>
              <span className="meta-pill">{project.sourceImageName}</span>
              <span className="meta-pill">{ui.spritesCount(project.sprites.length)}</span>
              <span className="meta-pill">
                {project.imageSize.width}×{project.imageSize.height}
              </span>
            </>
          ) : (
            <span className="meta-pill">{ui.emptyStageTitle}</span>
          )}
          <span className="meta-pill">{ui.historyState(historyIndex, historyTotal)}</span>
        </div>
        <div className="toolbar-status">{busyLabel || statusLabel}</div>
      </div>

      <div className="toolbar-section toolbar-actions">
        <div className="toolbar-button-row">
          <button className="primary command-button" onClick={importImage} type="button">
            <Upload size={16} />
            {ui.importPng}
          </button>
          <button
            className="command-button"
            disabled={!project || !!busyLabel}
            onClick={rerunDetection}
            type="button"
          >
            <RefreshCw size={16} />
            {ui.rerunDetection}
          </button>
          <button
            aria-label={ui.undo}
            className="icon-button"
            disabled={history.index <= 0 || !!busyLabel}
            onClick={handleUndo}
            title={ui.undo}
            type="button"
          >
            <RotateCcw size={17} />
          </button>
          <button
            aria-label={ui.redo}
            className="icon-button"
            disabled={history.index >= history.entries.length - 1 || !!busyLabel}
            onClick={handleRedo}
            title={ui.redo}
            type="button"
          >
            <RotateCw size={17} />
          </button>
        </div>
        <div className="language-switch" role="group" aria-label={ui.languageLabel}>
          <Languages size={15} />
          <div className="segmented compact">
            <button
              className={language === 'en' ? 'active' : ''}
              onClick={() => setLanguage('en')}
              type="button"
            >
              EN
            </button>
            <button
              className={language === 'zh' ? 'active' : ''}
              onClick={() => setLanguage('zh')}
              type="button"
            >
              中
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}

function ToolRail({
  deleteSelection,
  fitStageToViewport,
  project,
  reorderSprite,
  resetZoom,
  selectedIds,
  setTool,
  setZoom,
  tool,
  ui,
  updateProject,
  zoomIn,
  zoomOut,
  zoom,
}: {
  deleteSelection: () => void
  fitStageToViewport: () => void
  project: ProjectDocument | null
  reorderSprite: (direction: -1 | 1) => void
  resetZoom: () => void
  selectedIds: string[]
  setTool: (tool: ToolMode) => void
  setZoom: (zoom: number) => void
  tool: ToolMode
  ui: (typeof UI_TEXT)[Language]
  updateProject: (
    updater: (draft: ProjectDocument) => ProjectDocument,
    options?: { push?: boolean; selection?: string[] },
  ) => void
  zoomIn: () => void
  zoomOut: () => void
  zoom: number
}) {
  return (
    <aside className="tool-rail">
      <section className="panel-card rail-card tool-card">
        <div className="panel-header">
          <h2>{ui.canvasToolsTitle}</h2>
        </div>

        <div className="tool-mode-grid">
          <button
            aria-label={ui.selectTool}
            className={`tool-button large ${tool === 'select' ? 'active' : ''}`}
            onClick={() => setTool('select')}
            title={ui.selectTool}
            type="button"
          >
            <MousePointer2 size={20} />
            <span>{ui.selectTool}</span>
          </button>
          <button
            aria-label={ui.createBox}
            className={`tool-button large ${tool === 'create' ? 'active' : ''}`}
            onClick={() => setTool('create')}
            title={ui.createBox}
            type="button"
          >
            <BoxSelect size={20} />
            <span>{ui.createBox}</span>
          </button>
        </div>

        <div className="rail-section-title">{ui.zoom}</div>
        <div className="zoom-control">
          <input
            aria-label={ui.zoom}
            max={ZOOM_MAX}
            min={ZOOM_MIN}
            step={ZOOM_STEP}
            type="range"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          <strong>{Math.round(zoom * 100)}%</strong>
        </div>

        <div className="icon-grid">
          <button
            aria-label={ui.zoomOut}
            className="icon-button"
            disabled={!project}
            onClick={zoomOut}
            title={ui.zoomOut}
            type="button"
          >
            <ZoomOut size={17} />
          </button>
          <button
            aria-label={ui.zoomIn}
            className="icon-button"
            disabled={!project}
            onClick={zoomIn}
            title={ui.zoomIn}
            type="button"
          >
            <ZoomIn size={17} />
          </button>
          <button
            className="compact-action"
            disabled={!project}
            onClick={resetZoom}
            type="button"
          >
            {ui.actualSize}
          </button>
          <button
            aria-label={ui.fitToView}
            className="icon-button"
            disabled={!project}
            onClick={fitStageToViewport}
            title={ui.fitToView}
            type="button"
          >
            <Maximize2 size={17} />
          </button>
        </div>

        <div className="rail-section-title">{ui.selectionCount(selectedIds.length)}</div>
        <div className="icon-grid">
          <button
            aria-label={ui.delete}
            className="icon-button danger"
            disabled={selectedIds.length === 0}
            onClick={deleteSelection}
            title={ui.delete}
            type="button"
          >
            <Trash2 size={17} />
          </button>
          <button
            aria-label={ui.moveUp}
            className="icon-button"
            disabled={selectedIds.length !== 1}
            onClick={() => reorderSprite(-1)}
            title={ui.moveUp}
            type="button"
          >
            <ArrowUp size={17} />
          </button>
          <button
            aria-label={ui.moveDown}
            className="icon-button"
            disabled={selectedIds.length !== 1}
            onClick={() => reorderSprite(1)}
            title={ui.moveDown}
            type="button"
          >
            <ArrowDown size={17} />
          </button>
        </div>
      </section>

      <details className="panel-card rail-card settings-card">
        <summary>
          <span>
            <Settings2 size={16} />
            {ui.detectionTitle}
          </span>
        </summary>

        <div className="settings-body">
          <label>
            <span>{ui.alphaThreshold}</span>
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
            <span>{ui.minRegionArea}</span>
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
            <span>{ui.sortMode}</span>
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
                {ui.sortTopToBottom}
              </option>
              <option value="left-to-right-top-to-bottom">
                {ui.sortLeftToRight}
              </option>
            </select>
          </label>
        </div>
      </details>

      <details className="panel-card rail-card settings-card">
        <summary>
          <span>
            <PlusSquare size={16} />
            {ui.originalPrompt}
          </span>
        </summary>
        <div className="settings-body">
          <label className="prompt-field">
            <textarea
              disabled={!project}
              placeholder={ui.originalPromptPlaceholder}
              rows={4}
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
        </div>
      </details>
    </aside>
  )
}

function StageWorkspace({
  beginDragSelection,
  beginMove,
  beginResize,
  handleStagePointerDown,
  importImage,
  previewUrl,
  project,
  selectedIds,
  setSelectedIds,
  setTool,
  stageFrameRef,
  stageHeight,
  stageRef,
  stageWidth,
  statusLabel,
  tool,
  ui,
  zoom,
}: {
  beginDragSelection: (
    event: React.PointerEvent<HTMLElement>,
    spriteId: string,
  ) => void
  beginMove: (spriteId: string, additive: boolean) => void
  beginResize: (
    event: React.PointerEvent<HTMLButtonElement>,
    spriteId: string,
    handle: ResizeHandle,
  ) => void
  handleStagePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  importImage: () => void
  previewUrl: string
  project: ProjectDocument | null
  selectedIds: string[]
  setSelectedIds: (value: string[]) => void
  setTool: (tool: ToolMode) => void
  stageFrameRef: React.RefObject<HTMLDivElement | null>
  stageHeight: number
  stageRef: React.RefObject<HTMLDivElement | null>
  stageWidth: number
  statusLabel: string
  tool: ToolMode
  ui: (typeof UI_TEXT)[Language]
  zoom: number
}) {
  return (
    <section className="workspace-shell panel-card">
      <div className="workspace-topbar">
        <div className="panel-header">
          <h2>{project?.sourceImageName ?? ui.pageTitle}</h2>
          <p>{statusLabel}</p>
        </div>

        <div className="workspace-meta">
          <span className="meta-pill">{ui.spritesCount(project?.sprites.length ?? 0)}</span>
          <span className="meta-pill">{ui.selectionCount(selectedIds.length)}</span>
          <span className="meta-pill">{ui.zoom} {Math.round(zoom * 100)}%</span>
        </div>
      </div>

      <div className="stage-frame" ref={stageFrameRef}>
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
                <div
                  key={sprite.id}
                  className={`sprite-box ${selected ? 'selected' : ''}`}
                  onPointerDown={(event) => beginDragSelection(event, sprite.id)}
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
                  role="button"
                  tabIndex={0}
                >
                  <span className="sprite-index">{sprite.index}</span>
                  {selected ? (
                    <>
                      <button
                        aria-label={ui.resizeNorthWest}
                        className="resize-handle nw"
                        onPointerDown={(event) => beginResize(event, sprite.id, 'nw')}
                        type="button"
                      />
                      <button
                        aria-label={ui.resizeNorthEast}
                        className="resize-handle ne"
                        onPointerDown={(event) => beginResize(event, sprite.id, 'ne')}
                        type="button"
                      />
                      <button
                        aria-label={ui.resizeSouthWest}
                        className="resize-handle sw"
                        onPointerDown={(event) => beginResize(event, sprite.id, 'sw')}
                        type="button"
                      />
                      <button
                        aria-label={ui.resizeSouthEast}
                        className="resize-handle se"
                        onPointerDown={(event) => beginResize(event, sprite.id, 'se')}
                        type="button"
                      />
                    </>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="empty-stage">
            <div className="empty-stage-copy">
              <div className="toolbar-overline">SpriteSplit</div>
              <h2>{ui.emptyStageTitle}</h2>
              <p>{ui.emptyStageDescription}</p>
            </div>
            <button className="primary" onClick={importImage} type="button">
              {ui.selectPng}
            </button>
          </div>
        )}
      </div>

      {project ? (
        <div className="workspace-footer">
          <button
            className="ghost-button"
            onClick={() => {
              setTool('select')
              setSelectedIds([])
            }}
            type="button"
          >
            {ui.selectTool}
          </button>
          <div className="workspace-footer-copy">{ui.heroSubtitle}</div>
        </div>
      ) : null}
    </section>
  )
}

function InspectorPanel({
  activeSprite,
  busyState,
  chooseOutputDirectory,
  exportSettings,
  project,
  providerConfig,
  runDescriptionGeneration,
  runExport,
  selectedIds,
  setExportSettings,
  setProviderConfig,
  setSelectedIds,
  setSidebarTab,
  sidebarTab,
  ui,
  updateProject,
}: {
  activeSprite: SpriteRecord | null
  busyState: BusyState
  chooseOutputDirectory: () => void
  exportSettings: ExportSettings
  project: ProjectDocument | null
  providerConfig: ProviderConfig
  runDescriptionGeneration: (selectedOnly: boolean) => void
  runExport: () => void
  selectedIds: string[]
  setExportSettings: React.Dispatch<React.SetStateAction<ExportSettings>>
  setProviderConfig: React.Dispatch<React.SetStateAction<ProviderConfig>>
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>
  setSidebarTab: (tab: SidebarTab) => void
  sidebarTab: SidebarTab
  ui: (typeof UI_TEXT)[Language]
  updateProject: (
    update: (draft: ProjectDocument) => ProjectDocument,
    options?: { push?: boolean; selection?: string[] },
  ) => void
}) {
  const aiBusy = busyState === 'describing'
  const exportBusy = busyState === 'exporting'
  const projectChanging = busyState === 'analyzing' || busyState === 'rerunning'

  return (
    <aside className="inspector-shell">
      <section className="panel-card tabs-card">
        <div className="tabs">
          <button
            className={sidebarTab === 'inspect' ? 'active' : ''}
            onClick={() => setSidebarTab('inspect')}
            type="button"
          >
            <Settings2 size={15} />
            {ui.inspect}
          </button>
          <button
            className={sidebarTab === 'ai' ? 'active' : ''}
            onClick={() => setSidebarTab('ai')}
            type="button"
          >
            <Sparkles size={15} />
            {ui.ai}
          </button>
          <button
            className={sidebarTab === 'export' ? 'active' : ''}
            onClick={() => setSidebarTab('export')}
            type="button"
          >
            <Download size={15} />
            {ui.export}
          </button>
        </div>

        {sidebarTab === 'inspect' ? (
          <>
            <div className="panel-header">
              <h2>{ui.inspectorTitle}</h2>
              <p>{ui.inspectorDescription}</p>
            </div>
            {activeSprite ? (
              <div className="inspector-fields">
                <label>
                  <span>{ui.name}</span>
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
                  <span>{ui.group}</span>
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
                  <span>{ui.tags}</span>
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
                  <span>{ui.description}</span>
                  <textarea
                    rows={3}
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
                  <span>{ui.aiDescription}</span>
                  <textarea rows={3} value={activeSprite.aiDescription} readOnly />
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
                  ? ui.selectedSpritesMessage(selectedIds.length)
                  : ui.selectSpriteHint}
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
                        {ui.spriteLocation(
                          sprite.bbox.width,
                          sprite.bbox.height,
                          sprite.bbox.x,
                          sprite.bbox.y,
                        )}
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
              <h2>{ui.aiTitle}</h2>
              <p>{ui.aiDescriptionText}</p>
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
              <span>{ui.enableAiProvider}</span>
            </label>
            <label>
              <span>{ui.baseUrl}</span>
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
              <span>{ui.apiKey}</span>
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
              <span>{ui.model}</span>
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
              <span>{ui.sheetPrompt}</span>
              <textarea
                rows={3}
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
              <span>{ui.spritePrompt}</span>
              <textarea
                rows={3}
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
                disabled={!project || aiBusy || exportBusy || projectChanging}
                onClick={() => runDescriptionGeneration(false)}
                type="button"
              >
                {ui.describeAll}
              </button>
              <button
                disabled={
                  !project ||
                  selectedIds.length === 0 ||
                  aiBusy ||
                  exportBusy ||
                  projectChanging
                }
                onClick={() => runDescriptionGeneration(true)}
                type="button"
              >
                {ui.describeSelected}
              </button>
            </div>
            {project?.sheetContext ? (
              <div className="context-box">
                <strong>{ui.sheetContext}</strong>
                <p>{project.sheetContext}</p>
              </div>
            ) : null}
          </>
        ) : null}

        {sidebarTab === 'export' ? (
          <>
            <div className="panel-header">
              <h2>{ui.exportTitle}</h2>
              <p>{ui.exportDescription}</p>
            </div>
            <label>
              <span>{ui.outputDirectory}</span>
              <div className="path-row">
                <input readOnly type="text" value={exportSettings.outputDir} />
                <button className="icon-text-button" onClick={chooseOutputDirectory} type="button">
                  <FolderOpen size={15} />
                  {ui.browse}
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
              <span>{ui.exportCrops}</span>
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
              <span>{ui.normalizeCanvas}</span>
            </label>
            <div className="two-col">
              <label>
                <span>{ui.canvasWidth}</span>
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
                <span>{ui.canvasHeight}</span>
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
              <span>{ui.writeJson}</span>
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
              <span>{ui.writeCsv}</span>
            </label>
            <button
              className="primary icon-text-button"
              disabled={!project || exportBusy}
              onClick={runExport}
              type="button"
            >
              <Download size={16} />
              {ui.exportProject}
            </button>
          </>
        ) : null}
      </section>

      {project?.warnings?.length ? (
        <section className="panel-card warnings-card">
          <div className="panel-header">
            <h2>{ui.warningsTitle}</h2>
            <p>{ui.warningsDescription}</p>
          </div>
          <ul className="warning-list">
            {project.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
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

function buildExportStatus(
  result: ExportResult,
  ui: (typeof UI_TEXT)[Language],
) {
  const parts = []
  if (result.manifestPath) {
    parts.push(ui.exportJsonManifest)
  }
  if (result.csvPath) {
    parts.push(ui.exportCsvSummary)
  }
  if (result.exportedSprites.length) {
    parts.push(ui.exportCropsCount(result.exportedSprites.length))
  }
  return ui.exportStatus(
    parts.join(', '),
    result.manifestPath || result.csvPath || result.cropDirectory,
  )
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

function asErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'string') {
    return error
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message)
  }
  return fallback
}

function formatBusyLabel(
  busyState: BusyState,
  ui: (typeof UI_TEXT)[Language],
) {
  switch (busyState) {
    case 'analyzing':
      return ui.busyAnalyzing
    case 'rerunning':
      return ui.busyRerunning
    case 'describing':
      return ui.busyDescribing
    case 'exporting':
      return ui.busyExporting
    default:
      return ''
  }
}

function formatStatus(
  status: StatusState,
  ui: (typeof UI_TEXT)[Language],
) {
  switch (status.key) {
    case 'idle':
      return ui.statusIdle
    case 'runningDetection':
      return ui.statusRunningDetection
    case 'detected':
      return ui.statusDetected(status.count)
    case 'refreshed':
      return ui.statusRefreshed(status.alphaThreshold, status.minArea)
    case 'describedSelected':
      return ui.statusDescribedSelected(status.count)
    case 'describedAll':
      return ui.statusDescribedAll
    case 'undo':
      return ui.statusUndo
    case 'redo':
      return ui.statusRedo
    case 'deleted':
      return ui.statusDeleted(status.count)
    case 'moveUp':
      return ui.statusMoveUp
    case 'moveDown':
      return ui.statusMoveDown
    case 'ignoredTinyDraft':
      return ui.statusIgnoredTinyDraft
    case 'createdBox':
      return ui.statusCreatedBox
    case 'movedBoxes':
      return ui.statusMovedBoxes
    case 'resizedBox':
      return ui.statusResizedBox
    case 'exported':
      return buildExportStatus(status.result, ui)
  }
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100
}

function clampZoom(value: number) {
  return roundToTwo(clampNumber(value, ZOOM_MIN, ZOOM_MAX))
}

function calculateFitZoom(
  imageWidth: number,
  imageHeight: number,
  frame: HTMLDivElement,
) {
  const availableWidth = Math.max(frame.clientWidth - 36, 1)
  const availableHeight = Math.max(frame.clientHeight - 36, 1)
  const widthZoom = availableWidth / imageWidth
  const heightZoom = availableHeight / imageHeight
  return clampZoom(Math.min(widthZoom, heightZoom))
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
