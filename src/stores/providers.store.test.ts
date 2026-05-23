import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useProvidersStore } from './providers.store';

beforeEach(() => {
  useProvidersStore.getState()._reset();
  localStorage.clear();
});

describe('useProvidersStore', () => {
  it('init fetches the list and defaults to the server default when no localStorage entry', async () => {
    server.use(
      http.get('http://localhost/api/providers', () =>
        HttpResponse.json({
          providers: [
            { name: 'fake:default', transport: 'fake', model: 'default',
              capabilities: { thinking: true, toolCalling: true, vision: false }, displayName: 'Fake' },
          ],
        }),
      ),
      http.get('http://localhost/api/providers/default', () =>
        HttpResponse.json({ name: 'fake:default' }),
      ),
    );
    await useProvidersStore.getState().init();
    expect(useProvidersStore.getState().defaultProvider).toBe('fake:default');
    expect(useProvidersStore.getState().hydrated).toBe(true);
  });

  it('init prefers localStorage value when present and valid', async () => {
    localStorage.setItem('aether.defaultProvider', 'gemini:gemini-2.0-flash-exp');
    server.use(
      http.get('http://localhost/api/providers', () =>
        HttpResponse.json({
          providers: [
            { name: 'gemini:gemini-2.0-flash-exp', transport: 'gemini', model: 'gemini-2.0-flash-exp',
              capabilities: { thinking: true, toolCalling: true, vision: true }, displayName: 'Gemini / 2.0 flash' },
          ],
        }),
      ),
      http.get('http://localhost/api/providers/default', () =>
        HttpResponse.json({ name: 'gemini:gemini-2.0-flash-exp' }),
      ),
    );
    await useProvidersStore.getState().init();
    expect(useProvidersStore.getState().defaultProvider).toBe('gemini:gemini-2.0-flash-exp');
  });

  it('falls back to server default when localStorage entry is unavailable in registry', async () => {
    localStorage.setItem('aether.defaultProvider', 'ollama:gone');
    server.use(
      http.get('http://localhost/api/providers', () =>
        HttpResponse.json({
          providers: [
            { name: 'fake:default', transport: 'fake', model: 'default',
              capabilities: { thinking: true, toolCalling: true, vision: false }, displayName: 'Fake' },
          ],
        }),
      ),
      http.get('http://localhost/api/providers/default', () =>
        HttpResponse.json({ name: 'fake:default' }),
      ),
    );
    await useProvidersStore.getState().init();
    expect(useProvidersStore.getState().defaultProvider).toBe('fake:default');
  });

  it('setDefault writes localStorage', () => {
    useProvidersStore.getState().setDefault('fake:default');
    expect(localStorage.getItem('aether.defaultProvider')).toBe('fake:default');
    expect(useProvidersStore.getState().defaultProvider).toBe('fake:default');
  });

  it('capabilitiesOf returns the descriptor capabilities or null', () => {
    useProvidersStore.setState({
      list: [{
        name: 'ollama:llama3', transport: 'ollama', model: 'llama3',
        capabilities: { thinking: false, toolCalling: true, vision: false }, displayName: 'Ollama / llama3',
      }],
      defaultProvider: 'ollama:llama3',
      hydrated: true,
      error: null,
    });
    expect(useProvidersStore.getState().capabilitiesOf('ollama:llama3')).toEqual({ thinking: false, toolCalling: true, vision: false });
    expect(useProvidersStore.getState().capabilitiesOf('not-real')).toBeNull();
  });
});
