import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { PromptTemplate } from '../../shared/models';
import { reportError, unwrap } from '../utils/api';

export type PromptInput = Partial<PromptTemplate> & Pick<PromptTemplate, 'name' | 'scene' | 'content'>;

export const usePromptStore = defineStore('prompts', () => {
  const templates = ref<PromptTemplate[]>([]);
  const loading = ref(false);
  const loaded = ref(false);

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return;
    loading.value = true;
    try {
      templates.value = unwrap(await window.inkforge.prompt.list());
      loaded.value = true;
    } catch (error) {
      reportError(error);
    } finally {
      loading.value = false;
    }
  }

  async function save(input: PromptInput): Promise<PromptTemplate | null> {
    try {
      const template = unwrap(await window.inkforge.prompt.upsert(input));
      const index = templates.value.findIndex((item) => item.templateId === template.templateId);
      if (index >= 0) templates.value[index] = template;
      else templates.value.unshift(template);
      return template;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function remove(templateId: string): Promise<boolean> {
    try {
      unwrap(await window.inkforge.prompt.delete(templateId));
      templates.value = templates.value.filter((item) => item.templateId !== templateId);
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  async function markUsed(templateId: string): Promise<void> {
    try {
      const template = unwrap(await window.inkforge.prompt.markUsed(templateId));
      const index = templates.value.findIndex((item) => item.templateId === templateId);
      if (index >= 0) templates.value[index] = template;
    } catch (error) {
      reportError(error);
    }
  }

  async function importTemplates(): Promise<boolean> {
    try {
      const imported = unwrap(await window.inkforge.prompt.import());
      if (imported === null) return false;
      await load(true);
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  async function exportTemplates(): Promise<string | null> {
    try {
      return unwrap(await window.inkforge.prompt.export());
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  return { templates, loading, loaded, load, save, remove, markUsed, importTemplates, exportTemplates };
});
