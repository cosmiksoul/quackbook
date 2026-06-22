import { useRef, useState } from 'react'

interface Props {
  onFile: (file: File) => void
  disabled?: boolean
}

export function CsvDropzone({ onFile, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  function pick(files: FileList | null) {
    const file = files?.[0]
    if (file) onFile(file)
  }

  return (
    <div
      className={over ? 'dropzone over' : 'dropzone'}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (!disabled) pick(e.dataTransfer.files)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => pick(e.target.files)}
      />
      Перетащи CSV сюда или кликни, чтобы выбрать
    </div>
  )
}
