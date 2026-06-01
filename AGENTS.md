<claude-mem-context>
# Memory Context

# [SpriteSplit] recent context, 2026-06-01 8:52pm GMT+8

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 20 obs (7,183t read) | 0t work

### Jun 1, 2026
754 7:57p 🔄 SpriteSplit layout refactored to fit single viewport without scrolling
756 8:30p 🔵 SpriteSplit app architecture: Tauri + Vite + Python backend
757 " 🔵 SpriteSplit log location and Tauri IPC bridge
758 " 🔵 AI description generation may fail silently due to empty log file and silent early-exit paths
759 8:31p 🔵 Export button disabled condition and Tauri logging misconfiguration identified
760 " 🔵 Tauri plugin-log defaults to AppLog directory but needs explicit target configuration
761 " 🔴 Added Python subprocess logging infrastructure to Tauri commands.rs
762 8:32p 🟣 Added Python-side debug logging and configurable timeout for AI API requests
764 " 🔴 Fixed export button always grayed out by decoupling busy state from all operations
765 " 🔵 Rust-side logging confirmed working; Python runtime identified as Codex sandbox
769 8:39p 🟣 AI sprite description now generates structured metadata with names and descriptions
770 " 🟣 Added JSON cache, AI response parser, and asset name sanitizer for structured sprite metadata
771 8:40p 🟣 Added unique asset name deduplication for AI-generated sprite names
772 " 🔴 Cache key now includes sheetPrompt and spritePrompt for proper invalidation
773 8:41p ✅ Updated UI labels from "AI Descriptions" to "AI Naming" across English and Chinese locales
775 " 🟣 Added unit test for AI sprite naming with mocked OpenAI provider
793 8:47p 🟣 Added resizable left and right sidebar rails with persistent width storage
794 " 🟣 Added drag handles and dynamic grid layout for resizable sidebars
796 8:48p 🟣 Added CSS styles for sidebar resizers, settings scrollability, and form input styling
797 " 🔄 Refactored resizable sidebar from inline gridTemplateColumns to CSS custom properties
</claude-mem-context>