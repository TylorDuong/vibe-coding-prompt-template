type ProcessButtonProps = {
  onClick: () => void
  isProcessing: boolean
  disabled: boolean
}

export default function ProcessButton({
  onClick,
  isProcessing,
  disabled,
}: ProcessButtonProps): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isProcessing}
      className={`
        mx-4 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors
        ${
          disabled || isProcessing
            ? 'cursor-not-allowed bg-zinc-800 text-zinc-600'
            : 'bg-blue-600 text-white hover:bg-blue-500 active:bg-blue-700'
        }
      `}
    >
      {isProcessing ? (
        <span className="flex items-center gap-2">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
          Processing...
        </span>
      ) : (
        'Process Video'
      )}
    </button>
  )
}
