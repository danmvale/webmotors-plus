import type { JSX } from 'preact';
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { nameKey } from '../lib/webmotors/slug';
import { ChevronIcon, CloseIcon, Spinner } from './icons';

export interface ComboOption {
  value: string;
  label: string;
  disabled?: boolean;
  hint?: string;
}

export interface ComboboxProps {
  label: string;
  placeholder: string;
  options: ComboOption[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
  loading?: boolean;
  emptyText?: string;
  /** Allow clearing back to `undefined`. */
  clearable?: boolean;
}

const MAX_VISIBLE = 80;

/** Accessible, filterable select (ARIA combobox + listbox) in the site's input style. */
export function Combobox(props: ComboboxProps) {
  const { label, placeholder, options, value, onChange, disabled, loading, emptyText = 'Nada encontrado', clearable } = props;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = nameKey(text);
    const list = q ? options.filter((o) => nameKey(o.label).includes(q)) : options;
    return list.slice(0, MAX_VISIBLE);
  }, [options, text]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !e.composedPath().includes(rootRef.current)) close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const close = () => {
    setOpen(false);
    setText('');
  };

  const pick = (option: ComboOption | undefined) => {
    if (!option || option.disabled) return;
    onChange(option.value);
    close();
  };

  const move = (delta: number) => {
    if (!filtered.length) return;
    let next = active;
    for (let i = 0; i < filtered.length; i++) {
      next = (next + delta + filtered.length) % filtered.length;
      if (!filtered[next]?.disabled) break;
    }
    setActive(next);
  };

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      else move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      if (open) {
        e.preventDefault();
        pick(filtered[active]);
      }
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close();
    }
  };

  return (
    <div class={`wmp-combo${disabled ? ' wmp-combo--disabled' : ''}`} ref={rootRef}>
      <label class="wmp-combo__label" for={`${id}-input`}>
        {label}
      </label>
      <div class={`wmp-combo__control${open ? ' wmp-combo__control--open' : ''}`}>
        <input
          ref={inputRef}
          id={`${id}-input`}
          class="wmp-combo__input"
          type="text"
          role="combobox"
          autoComplete="off"
          spellcheck={false}
          disabled={disabled}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[active] ? `${id}-opt-${active}` : undefined}
          placeholder={selected ? selected.label : placeholder}
          value={open ? text : (selected?.label ?? '')}
          onFocus={() => {
            setOpen(true);
            const index = filtered.findIndex((o) => o.value === value);
            setActive(Math.max(0, index));
          }}
          onClick={() => setOpen(true)}
          onInput={(e) => {
            setText(e.currentTarget.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {loading ? (
          <span class="wmp-combo__adorn">
            <Spinner size={14} />
          </span>
        ) : clearable && selected && !open ? (
          <button
            type="button"
            class="wmp-combo__adorn wmp-combo__clear"
            aria-label={`Limpar ${label}`}
            onClick={() => {
              onChange(undefined);
              inputRef.current?.focus();
            }}
          >
            <CloseIcon size={14} />
          </button>
        ) : (
          <span class="wmp-combo__adorn wmp-combo__chevron" aria-hidden="true">
            <ChevronIcon size={14} />
          </span>
        )}
      </div>
      {open && !disabled && (
        <ul class="wmp-combo__list" id={`${id}-list`} role="listbox" ref={listRef} aria-label={label}>
          {filtered.length === 0 && (
            <li class="wmp-combo__empty" role="presentation">
              {loading ? 'Carregando…' : emptyText}
            </li>
          )}
          {filtered.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-opt-${index}`}
              data-index={index}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              class={`wmp-combo__option${index === active ? ' wmp-combo__option--active' : ''}`}
              onPointerDown={(e) => e.preventDefault()}
              onPointerMove={() => !option.disabled && setActive(index)}
              onClick={() => pick(option)}
            >
              <span>{option.label}</span>
              {option.hint && <small>{option.hint}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
