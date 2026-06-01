export type SortMode = 'top-to-bottom-left-to-right' | 'left-to-right-top-to-bottom'

export interface Point {
  x: number
  y: number
}

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface SpriteRecord {
  id: string
  index: number
  bbox: BoundingBox
  center: Point
  area: number
  name: string
  description: string
  aiDescription: string
  tags: string[]
  group: string
  cropPath: string
}

export interface DetectionSettings {
  alphaThreshold: number
  minArea: number
  sortMode: SortMode
}

export interface ExportSettings {
  outputDir: string
  exportCrops: boolean
  normalizeCanvas: boolean
  canvasWidth: number
  canvasHeight: number
  includeJson: boolean
  includeCsv: boolean
}

export interface ProviderConfig {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
  sheetPrompt: string
  spritePrompt: string
  spriteIds?: string[]
}

export interface ProjectDocument {
  sourceImagePath: string
  sourceImageName: string
  imageSize: {
    width: number
    height: number
  }
  detectionSettings: DetectionSettings
  prompt: string
  sheetContext: string
  sprites: SpriteRecord[]
  warnings: string[]
  exportSettings?: ExportSettings
}

export interface ExportResult {
  project: ProjectDocument
  manifestPath: string
  csvPath: string
  cropDirectory: string
  exportedSprites: string[]
}
