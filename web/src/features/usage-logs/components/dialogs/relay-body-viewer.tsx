/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Braces, FileText, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

type BodyView = 'json' | 'text'

function tryParseJson(value: string): unknown | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function formatJson(value: string): string {
  const parsed = tryParseJson(value)
  return parsed === null ? value : JSON.stringify(parsed, null, 2)
}

export function RelayBodyViewer(props: { value: string }) {
  const { t } = useTranslation()
  const isJson = tryParseJson(props.value) !== null
  const [view, setView] = useState<BodyView>(isJson ? 'json' : 'text')
  const [formatted, setFormatted] = useState(true)
  const [wrap, setWrap] = useState(true)

  const displayValue =
    view === 'json' && formatted ? formatJson(props.value) : props.value

  return (
    <div className='min-w-0 space-y-1.5'>
      <div className='flex flex-wrap items-center gap-1.5'>
        <ToggleGroup
          size='sm'
          variant='outline'
          spacing={0}
          aria-label={t('View format')}
          value={[view]}
          onValueChange={(values) => {
            if (values[0] === 'json' || values[0] === 'text') {
              setView(values[0])
            }
          }}
        >
          <ToggleGroupItem value='json' disabled={!isJson}>
            <Braces className='size-3.5' aria-hidden='true' />
            {t('JSON')}
          </ToggleGroupItem>
          <ToggleGroupItem value='text'>
            <FileText className='size-3.5' aria-hidden='true' />
            {t('Text')}
          </ToggleGroupItem>
        </ToggleGroup>

        {view === 'json' ? (
          <Toggle
            size='sm'
            variant='outline'
            pressed={formatted}
            onPressedChange={setFormatted}
            aria-label={t('Format JSON')}
          >
            <Wand2 className='size-3.5' aria-hidden='true' />
            {t('Format')}
          </Toggle>
        ) : (
          <Toggle
            size='sm'
            variant='outline'
            pressed={wrap}
            onPressedChange={setWrap}
            aria-label={t('Word wrap')}
          >
            {t('Word wrap')}
          </Toggle>
        )}

        <CopyButton value={props.value} className='ml-auto' />
      </div>

      <pre
        className={cn(
          'bg-background/50 max-h-64 min-w-0 overflow-auto rounded-md border p-2 font-mono text-[11px] leading-relaxed',
          wrap ? 'wrap-break-word whitespace-pre-wrap' : 'whitespace-pre'
        )}
      >
        {displayValue}
      </pre>
    </div>
  )
}
