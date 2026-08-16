import { DocumentAdapter } from '../interfaces.js';
import { MarkdownAdapter } from './markdown.adapter.js';
import { JsonAdapter } from './json.adapter.js';
import { TextAdapter } from './text.adapter.js';

export class AdapterRegistry {
  private adapters: Map<string, DocumentAdapter> = new Map();

  constructor() {
    this.register(new MarkdownAdapter());
    this.register(new JsonAdapter());
    this.register(new TextAdapter());
  }

  register(adapter: DocumentAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  getAdapter(id: string): DocumentAdapter | undefined {
    return this.adapters.get(id);
  }

  getAdapterByFilename(filename: string): DocumentAdapter {
    const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')).toLowerCase() : '';
    for (const adapter of this.adapters.values()) {
      if (adapter.supportedExtensions.includes(ext)) {
        return adapter;
      }
    }
    // Default fallback to Markdown adapter
    return this.adapters.get('markdown')!;
  }

  getAllAdapters(): Array<{ id: string; name: string; supportedExtensions: string[]; description: string }> {
    return Array.from(this.adapters.values()).map((a) => ({
      id: a.id,
      name: a.name,
      supportedExtensions: a.supportedExtensions,
      description: a.description,
    }));
  }
}

export const defaultRegistry = new AdapterRegistry();
