import React from 'react';
import { useProjectStore } from '../stores/project-store';
import { useTimelineStore } from '../stores/timeline-store';
import { useUIStore } from '../stores/ui-store';
import { Undo2, Redo2, Scissors, Trash2, Plus, Magnet, ZoomOut, ZoomIn } from 'lucide-react';

/**
 * Bottom toolbar for mobile layout (CapCut style).
 * Dispatches actions via the existing stores (project, timeline, UI).
 */
const ToolbarBottom: React.FC = () => {
  const { undo, redo, canUndo, canRedo, splitClip, removeClip } = useProjectStore();
  const { zoomIn, zoomOut, playheadPosition } = useTimelineStore();
  const { togglePanel, getSelectedClipIds, toggleSnap, snapSettings } = useUIStore();

  const selectedClipIds = getSelectedClipIds();

  const handleSplit = async () => {
    if (selectedClipIds.length === 1) {
      await splitClip(selectedClipIds[0], playheadPosition);
    }
  };

  const handleDelete = async () => {
    if (selectedClipIds.length === 0) return;
    for (const id of selectedClipIds) {
      await removeClip(id);
    }
  };

  return (
    <div className="flex items-center px-3 py-1.5 gap-0.5 bg-bg-1 border-t border-border shrink-0">
      <button onClick={undo} disabled={!canUndo()} title="Undo" className="p-2">
        <Undo2 size={16} />
      </button>
      <button onClick={redo} disabled={!canRedo()} title="Redo" className="p-2">
        <Redo2 size={16} />
      </button>
      <div className="w-px h-4 bg-border mx-1.5" />
      <button onClick={handleSplit} title="Split" className="p-2">
        <Scissors size={16} />
      </button>
      <button onClick={handleDelete} title="Delete" className="p-2">
        <Trash2 size={16} />
      </button>
      <div className="w-px h-4 bg-border mx-1.5" />
      {/* Add Track placeholder */}
      <button onClick={() => togglePanel('mediaLibrary')} title="Media Library" className="p-2">
        <Plus size={16} />
      </button>
      <div className="w-px h-4 bg-border mx-1.5" />
      <button onClick={toggleSnap} title={snapSettings.enabled ? 'Snap On' : 'Snap Off'} className="p-2">
        <Magnet size={16} />
      </button>
      <div className="w-px h-4 bg-border mx-1.5" />
      <button onClick={zoomOut} title="Zoom Out" className="p-2">
        <ZoomOut size={16} />
      </button>
      <button onClick={zoomIn} title="Zoom In" className="p-2">
        <ZoomIn size={16} />
      </button>
    </div>
  );
};

export default ToolbarBottom;
