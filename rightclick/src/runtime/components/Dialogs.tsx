import { React } from 'jimu-core'
import { Button, Checkbox, Modal, ModalBody, ModalFooter, ModalHeader, NumericInput, Option, Select, TextInput } from 'jimu-ui'
import { useTokens } from '../theme'

// The two dialogs the Right Click widget opens from the context menu, built on
// jimu-ui so they look and behave like every other dialog in the app: theme
// colors, dark mode, focus kept inside, Escape and the header X close them.
// Strings are passed in as props (same approach as HelpPopup), so these
// components carry no copy of their own.

const { useState, useEffect } = React

/** Move focus to an element by id once the Modal has mounted it. jimu-ui's
 *  Modal renders in a portal and moves focus to the dialog itself, so the
 *  first field is focused a moment later. */
const focusById = (id: string): void => {
  window.setTimeout(() => {
    const el = document.getElementById(id) as HTMLElement | null
    if (el && typeof el.focus === 'function') el.focus()
  }, 80)
}

// ───────────────────────────── Add Text ─────────────────────────────

export const TEXT_DIALOG_INPUT_ID = 'rc-map-text-input'

export interface TextInputDialogProps {
  open: boolean
  /** Called with the trimmed text when the user confirms. */
  onSubmit: (text: string) => void
  onCancel: () => void
  title: string
  description: string
  inputLabel: string
  placeholder: string
  submitLabel: string
  cancelLabel: string
}

export const TextInputDialog: React.FC<TextInputDialogProps> = ({
  open, onSubmit, onCancel, title, description, inputLabel, placeholder, submitLabel, cancelLabel
}) => {
  const tokens = useTokens()
  const [value, setValue] = useState('')

  // Each opening starts empty and puts the cursor in the box.
  useEffect(() => {
    if (open) { setValue(''); focusById(TEXT_DIALOG_INPUT_ID) }
  }, [open])

  if (!open) return null

  const trimmed = value.trim()
  const submit = (): void => { if (trimmed) onSubmit(trimmed) }
  const descriptionId = 'rc-text-dialog-description'

  return (
    <Modal isOpen centered toggle={onCancel} size="sm">
      <ModalHeader toggle={onCancel}>{title}</ModalHeader>
      <ModalBody>
        <p id={descriptionId} style={{ margin: '0 0 12px 0', fontSize: '13px', lineHeight: 1.5, color: tokens.textSecondary }}>{description}</p>
        <label htmlFor={TEXT_DIALOG_INPUT_ID} style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600, color: tokens.text }}>{inputLabel}</label>
        <TextInput
          id={TEXT_DIALOG_INPUT_ID}
          type="text"
          placeholder={placeholder}
          aria-describedby={descriptionId}
          value={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setValue(e.target.value) }}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
        />
      </ModalBody>
      <ModalFooter>
        <Button onClick={onCancel}>{cancelLabel}</Button>
        <Button type="primary" disabled={!trimmed} onClick={submit}>{submitLabel}</Button>
      </ModalFooter>
    </Modal>
  )
}

// ─────────────────────── Mailing Labels buffer ───────────────────────

export type BufferUnit = 'feet' | 'meters' | 'kilometers' | 'miles'

export const BUFFER_DIALOG_CHECKBOX_ID = 'rc-mailing-labels-apply-buffer'

export interface MailingLabelsBufferDialogProps {
  open: boolean
  enabled: boolean
  distance: string
  unit: BufferUnit
  /** Validation message from the widget; empty when there is none. */
  error: string
  onEnabledChange: (enabled: boolean) => void
  onDistanceChange: (distance: string) => void
  onUnitChange: (unit: BufferUnit) => void
  onSubmit: () => void
  onCancel: () => void
  title: string
  description: string
  applyBufferLabel: string
  distanceLabel: string
  unitLabel: string
  /** Display names for the four units, already in the app language. */
  unitNames: { [K in BufferUnit]: string }
  submitLabel: string
  cancelLabel: string
}

const BUFFER_UNITS: BufferUnit[] = ['feet', 'meters', 'kilometers', 'miles']

export const MailingLabelsBufferDialog: React.FC<MailingLabelsBufferDialogProps> = ({
  open, enabled, distance, unit, error,
  onEnabledChange, onDistanceChange, onUnitChange, onSubmit, onCancel,
  title, description, applyBufferLabel, distanceLabel, unitLabel, unitNames, submitLabel, cancelLabel
}) => {
  const tokens = useTokens()

  // Land on the first control so keyboard and screen reader users start there.
  useEffect(() => {
    if (open) focusById(BUFFER_DIALOG_CHECKBOX_ID)
  }, [open])

  if (!open) return null

  const descriptionId = 'rc-mailing-labels-dialog-description'
  const distanceId = 'rc-mailing-labels-buffer-distance'
  const unitId = 'rc-mailing-labels-buffer-unit'
  const errorId = 'rc-mailing-labels-buffer-error'
  const numeric = distance === '' || isNaN(Number(distance)) ? undefined : Number(distance)

  return (
    <Modal isOpen centered toggle={onCancel} size="sm">
      <ModalHeader toggle={onCancel}>{title}</ModalHeader>
      <ModalBody>
        <p id={descriptionId} style={{ margin: '0 0 12px 0', fontSize: '13px', lineHeight: 1.5, color: tokens.text }}>{description}</p>

        {/* The checkbox sits inside its label so the text is clickable too. */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '13px', fontWeight: 600, color: tokens.text, cursor: 'pointer' }}>
          <Checkbox
            id={BUFFER_DIALOG_CHECKBOX_ID}
            checked={enabled}
            aria-describedby={descriptionId}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { onEnabledChange(!!e.target.checked) }}
          />
          {applyBufferLabel}
        </label>

        {/* Two rows so neither field is squeezed in a narrow dialog. Dimmed
            while the checkbox is off, which shows what the checkbox controls. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', opacity: enabled ? 1 : 0.55 }}>
          <div style={{ flex: '1 1 110px', minWidth: 0 }}>
            <label htmlFor={distanceId} style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: tokens.textSecondary }}>{distanceLabel}</label>
            <NumericInput
              id={distanceId}
              size="sm"
              min={0}
              value={numeric}
              disabled={!enabled}
              aria-describedby={error ? errorId : undefined}
              style={{ width: '100%' }}
              onChange={(v: number | undefined) => { onDistanceChange(v == null || isNaN(Number(v)) ? '' : String(v)) }}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit() } }}
            />
          </div>
          <div style={{ flex: '1 1 130px', minWidth: 0 }}>
            <label htmlFor={unitId} style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: tokens.textSecondary }}>{unitLabel}</label>
            <Select
              id={unitId}
              size="sm"
              value={unit}
              disabled={!enabled}
              onChange={(e: any) => { onUnitChange(e.target.value as BufferUnit) }}
            >
              {BUFFER_UNITS.map((u: BufferUnit) => <Option key={u} value={u}>{unitNames[u]}</Option>)}
            </Select>
          </div>
        </div>

        {error && (
          <div id={errorId} role="alert" style={{ marginTop: '10px', fontSize: '13px', lineHeight: 1.4, color: tokens.danger }}>{error}</div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button onClick={onCancel}>{cancelLabel}</Button>
        <Button type="primary" onClick={onSubmit}>{submitLabel}</Button>
      </ModalFooter>
    </Modal>
  )
}
