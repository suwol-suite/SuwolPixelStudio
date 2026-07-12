import type { SuwolDesktopApi, WorkspaceLayout } from "@suwol/shared";

declare global {
  const __SUWOL_E2E__: boolean;
  interface Window {
    readonly suwolDesktop?: SuwolDesktopApi;
    suwolTest?: Readonly<{
      getActiveDocumentHash(): string | null;
      getActiveFrameHash(): string | null;
      getPaletteSize(): number;
      getCanvasSize(): Readonly<{ width: number; height: number }> | null;
      getActivePixel(x: number, y: number): readonly number[] | null;
      getViewport(): Readonly<{
        panX: number;
        panY: number;
        zoom: number;
        viewportWidth: number;
        viewportHeight: number;
      }> | null;
      getWorkspaceLayout(): WorkspaceLayout;
      getAnimationState(): Readonly<{
        frameCount: number;
        activeFrameIndex: number;
        durations: readonly number[];
        celCount: number;
        imageCount: number;
        linkedImageCount: number;
        tags: readonly Readonly<{
          name: string;
          playback: string;
          from: number;
          to: number;
        }>[];
        isPlaying: boolean;
        playbackMode: string;
        onionSkin: boolean;
      }> | null;
      openPluginManager(): void;
      executeCommand(commandId: string): Promise<unknown>;
      getLayerCount(): number;
      getProfessionalState(): Readonly<{
        schemaVersion: number;
        colorMode: string;
        layerKinds: readonly string[];
        paletteSize: number;
      }> | null;
      getPluginState(): Readonly<{
        safeMode: boolean;
        installed: readonly Readonly<{
          id: string;
          enabled: boolean;
          runtimeStatus: string;
          grants: readonly string[];
        }>[];
      }>;
    }>;
  }
}

export {};
