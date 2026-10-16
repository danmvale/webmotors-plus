import { useEffect, useMemo, useState } from 'preact/hooks';
import { vehicleName } from '../../lib/format';
import { useStore } from '../../lib/store';
import { getAutocomplete } from '../../lib/webmotors/client';
import { nameKey } from '../../lib/webmotors/slug';
import type { AutocompleteBrand } from '../../lib/webmotors/types';
import { type ComboOption, Combobox } from '../../ui/Combobox';
import { BlockIcon, CloseIcon } from '../../ui/icons';
import type { SearchPageApp } from '../search-page/app';
import { addMake, addModel, blacklistSize, EMPTY_BLACKLIST, removeMake, removeModel } from './blacklist';

const ALL_MODELS = '';

/** "Lista negra" filter card, placed right after the site's Marca filter. */
export function BlacklistSection({ app }: { app: SearchPageApp }) {
  const search = useStore(app.search);
  const blacklist = search.blacklist;
  const [brands, setBrands] = useState<AutocompleteBrand[]>();
  const [loadError, setLoadError] = useState(false);
  const [make, setMake] = useState<string>();
  const [model, setModel] = useState<string | undefined>(ALL_MODELS);

  useEffect(() => {
    getAutocomplete()
      .then(setBrands)
      .catch(() => setLoadError(true));
  }, []);

  const selectedMakes = useMemo(() => new Set(search.groups.map((g) => nameKey(g.make))), [search.groups]);
  const blacklistedMakes = useMemo(() => new Set(blacklist.makes.map(nameKey)), [blacklist]);

  const makeOptions: ComboOption[] = useMemo(
    () =>
      (brands ?? [])
        .map((b) => {
          const key = nameKey(b.name);
          const hint = selectedMakes.has(key)
            ? 'Já selecionada no filtro Marca'
            : blacklistedMakes.has(key)
              ? 'Já está na lista negra'
              : undefined;
          return { value: b.name, label: vehicleName(b.name), disabled: !!hint, hint };
        })
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    [brands, selectedMakes, blacklistedMakes],
  );

  const modelOptions: ComboOption[] = useMemo(() => {
    const brand = brands?.find((b) => nameKey(b.name) === nameKey(make ?? ''));
    if (!brand) return [];
    const pinned = search.groups
      .filter((g) => nameKey(g.make) === nameKey(brand.name) && g.model)
      .map((g) => nameKey(g.model!));
    const listed = new Set(blacklist.models.filter((m) => nameKey(m.make) === nameKey(brand.name)).map((m) => nameKey(m.model)));
    return [
      { value: ALL_MODELS, label: 'Todos os modelos' },
      ...brand.items
        .map((m) => {
          const key = nameKey(m.name);
          const hint = pinned.includes(key) ? 'Já selecionado no filtro Modelo' : listed.has(key) ? 'Já está na lista negra' : undefined;
          return { value: m.name, label: m.name, disabled: !!hint, hint };
        })
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    ];
  }, [brands, make, blacklist, search.groups]);

  const apply = () => {
    if (!make) return;
    const next = model ? addModel(blacklist, make, model) : addMake(blacklist, make);
    setMake(undefined);
    setModel(ALL_MODELS);
    if (next !== blacklist) app.applyBlacklist(next);
  };

  const size = blacklistSize(blacklist);

  return (
    <section class="wmp-root wmp-bl" aria-labelledby="wmp-bl-title">
      <div class="wmp-bl__header">
        <h3 class="wmp-bl__title" id="wmp-bl-title">
          Lista negra
        </h3>
        {size > 0 && <span class="wmp-bl__count">{size}</span>}
      </div>
      <p class="wmp-bl__hint">Oculte marcas e modelos desta busca.</p>

      <div class="wmp-bl__form">
        <Combobox
          label="Marca"
          placeholder="Selecione a marca"
          options={makeOptions}
          value={make}
          loading={!brands && !loadError}
          emptyText={loadError ? 'Não foi possível carregar as marcas' : 'Nenhuma marca encontrada'}
          onChange={(value) => {
            setMake(value);
            setModel(ALL_MODELS);
          }}
        />
        <Combobox
          label="Modelo"
          placeholder="Todos os modelos"
          options={modelOptions}
          value={model}
          disabled={!make}
          onChange={(value) => setModel(value ?? ALL_MODELS)}
        />
        <button type="button" class="wmp-btn wmp-btn--primary wmp-bl__apply" disabled={!make} onClick={apply}>
          Aplicar
        </button>
      </div>

      {blacklist.makes.length > 0 && (
        <div class="wmp-bl__group">
          <span class="wmp-bl__group-title">Marcas ocultas</span>
          <ul class="wmp-bl__chips">
            {blacklist.makes.map((m) => (
              <li key={m}>
                <Chip label={vehicleName(m)} onRemove={() => app.applyBlacklist(removeMake(blacklist, m))} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {blacklist.models.length > 0 && (
        <div class="wmp-bl__group">
          <span class="wmp-bl__group-title">Modelos ocultos</span>
          <ul class="wmp-bl__chips">
            {blacklist.models.map((m) => (
              <li key={`${m.make}:${m.model}`}>
                <Chip
                  label={`${vehicleName(m.make)} ${vehicleName(m.model)}`}
                  onRemove={() => app.applyBlacklist(removeModel(blacklist, m.make, m.model))}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {size > 1 && (
        <button type="button" class="wmp-link wmp-bl__clear" onClick={() => app.applyBlacklist(EMPTY_BLACKLIST)}>
          Limpar lista negra
        </button>
      )}
    </section>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span class="wmp-chip">
      <BlockIcon size={14} />
      <span class="wmp-chip__label">{label}</span>
      <button type="button" class="wmp-chip__remove" aria-label={`Remover ${label} da lista negra`} onClick={onRemove}>
        <CloseIcon size={14} />
      </button>
    </span>
  );
}
