import { convertFileSrc, invoke } from '@tauri-apps/api/core'

import type { ExportResult, ProjectDocument, ProviderConfig } from './types'

export const isTauriRuntime = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const filePathToUrl = (path: string) => convertFileSrc(path)

export const analyzeImage = async (input: {
  imagePath: string
  settings: ProjectDocument['detectionSettings']
  prompt?: string
}) => invoke<ProjectDocument>('analyze_image', { input })

export const generateDescriptions = async (
  project: ProjectDocument,
  providerConfig: ProviderConfig,
) =>
  invoke<ProjectDocument>('generate_descriptions', {
    project,
    providerConfig,
  })

export const exportProject = async (
  project: ProjectDocument,
  exportSettings: ProjectDocument['exportSettings'],
) =>
  invoke<ExportResult>('export_project', {
    project,
    exportSettings,
  })
