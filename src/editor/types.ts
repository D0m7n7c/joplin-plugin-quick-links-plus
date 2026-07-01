// editor/types.ts

export interface PluginContext {
	postMessage(message: any): Promise<any>;
}
