import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { SnackbarMessage } from '../types';

function SnackbarItem({ snackbar }: { snackbar: SnackbarMessage }) {
  const { removeSnackbar } = useEditorStore();

  useEffect(() => {
    const timer = setTimeout(() => {
      removeSnackbar(snackbar.id);
    }, 4000); // auto-hide after 4 seconds
    return () => clearTimeout(timer);
  }, [snackbar.id, removeSnackbar]);

  const bgColors = {
    error: 'bg-red-900 border-red-500 text-red-100',
    success: 'bg-green-900 border-green-500 text-green-100',
    info: 'bg-blue-900 border-blue-500 text-blue-100',
  };

  return (
    <div
      className={`pointer-events-auto px-4 py-3 rounded shadow-lg border-l-4 ${bgColors[snackbar.type]} flex items-center gap-3 transition-all animate-in slide-in-from-bottom-5`}
      style={{ minWidth: '300px' }}
    >
      <div className="flex-1 text-sm font-medium">
        {snackbar.message}
      </div>
      <button 
        onClick={() => removeSnackbar(snackbar.id)}
        className="opacity-50 hover:opacity-100 transition-opacity p-1"
      >
        ✕
      </button>
    </div>
  );
}

export default function SnackbarUI() {
  const snackbars = useEditorStore(state => state.snackbars);

  if (snackbars.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {snackbars.map(s => (
        <SnackbarItem key={s.id} snackbar={s} />
      ))}
    </div>
  );
}
