import { api } from '../../api';
import {
  DND5E_CHARACTER_SHEET_PLUGIN_ID,
  type CharacterRuleCatalog,
  type Dnd5eCharacterSheet,
  type ImportedCharacterResult,
  type PersonalCharacter,
} from '../../types';

const ID = DND5E_CHARACTER_SHEET_PLUGIN_ID;

export const characterSheetApi = {
  rules: () => api.plugin<CharacterRuleCatalog>(ID, '/rules'),
  characters: () => api.plugin<{ characters: PersonalCharacter[] }>(ID, '/characters')
    .then(response => response.characters),
  createCharacter: (input: { name: string; color?: string; sheet?: Dnd5eCharacterSheet }) =>
    api.plugin<PersonalCharacter>(ID, '/characters', jsonRequest('POST', input)),
  updateCharacter: (id: string, input: { name?: string; color?: string; status?: PersonalCharacter['status']; sheet?: Dnd5eCharacterSheet }) =>
    api.plugin<PersonalCharacter>(ID, `/characters/${encodeURIComponent(id)}`, jsonRequest('PATCH', input)),
  deleteCharacter: (id: string) => api.plugin<{ ok: boolean }>(
    ID, `/characters/${encodeURIComponent(id)}`, jsonRequest('DELETE'),
  ),
  roomCharacters: () => api.roomPlugin<{ characters: PersonalCharacter[] }>(ID, '/characters')
    .then(response => response.characters),
  importIntoRoom: (id: string) => api.roomPlugin<ImportedCharacterResult>(
    ID, `/characters/${encodeURIComponent(id)}/import`, jsonRequest('POST'),
  ),
};

function jsonRequest(method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}
