import type {PluginOption} from 'vite';
export interface ArcBridgeConfig {
 appId: string; htmlEntry?: string; outputDirectory?: string; outputFile?: 'index.html';
 contractFile?: string; browserDevelopmentConfig?: string; devOnly?: string[];
 flutter?: {assetDirectory: string}; port?: number; plugins?: PluginOption[];
}
export function defineConfig<T extends ArcBridgeConfig>(config: T): T;
export function loadConfig(root?: string): Promise<ArcBridgeConfig & Record<string, unknown>>;
