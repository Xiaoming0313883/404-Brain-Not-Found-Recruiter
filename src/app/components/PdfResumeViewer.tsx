import { useState, useEffect } from 'react';
import { FileText, Loader2, ExternalLink } from 'lucide-react';

interface PdfResumeViewerProps {
  url: string;
  filename?: string;
}

export function PdfResumeViewer({ url, filename }: PdfResumeViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const fetchPdf = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP error ${res.status}`);
        }
        
        const blob = await res.blob();
        if (!active) return;
        
        const bUrl = URL.createObjectURL(blob);
        setBlobUrl(bUrl);
      } catch (err: any) {
        if (active) {
          console.error("Failed to fetch PDF blob:", err);
          setError(err.message || 'Failed to load PDF');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    fetchPdf();

    return () => {
      active = false;
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [url]);

  const openPdfInBrowser = () => {
    if (blobUrl) {
      window.open(blobUrl, '_blank');
    } else {
      window.open(url, '_blank');
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-80 rounded-xl border border-[#e4e1da] bg-[#f7f6f3] gap-3">
        <Loader2 className="w-8 h-8 text-[#2d6a55] animate-spin" />
        <p className="text-xs text-[#6b7063] font-medium">Loading PDF document...</p>
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-80 rounded-xl border border-[#e4e1da] bg-[#f7f6f3] gap-3 p-6 text-center">
        <FileText className="w-8 h-8 text-[#b91c1c] opacity-60" />
        <p className="text-sm font-semibold text-[#1c1c1a]">Resume Preview Unavailable</p>
        <p className="text-xs text-[#6b7063] max-w-xs mb-1">
          Could not fetch the document directly from the server.
        </p>
        <button
          onClick={openPdfInBrowser}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#2d6a55] text-white rounded-lg text-xs font-medium hover:bg-[#245747] transition-colors cursor-pointer"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open Document Link
        </button>
      </div>
    );
  }

  return (
    <div className="w-full">
      <object
        data={`${blobUrl}#toolbar=1&navpanes=0`}
        type="application/pdf"
        className="w-full h-[500px] rounded-xl border border-[#e4e1da]"
      >
        <div className="flex flex-col items-center justify-center h-80 rounded-xl border border-[#e4e1da] bg-[#f7f6f3] gap-3 p-4 text-center">
          <FileText className="w-8 h-8 text-[#a8a49d]" />
          <p className="text-sm text-[#6b7063]">PDF preview unavailable in this browser.</p>
          <button
            onClick={openPdfInBrowser}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#2d6a55] text-white rounded-lg text-xs font-medium hover:bg-[#245747] transition-colors cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open Resume in Browser
          </button>
        </div>
      </object>
      <div className="mt-2 flex items-center justify-between">
        {filename && (
          <span className="text-xs text-[#a8a49d] truncate max-w-xs">
            File: {filename}
          </span>
        )}
        <button
          onClick={openPdfInBrowser}
          className="inline-flex items-center gap-1 text-xs text-[#2d6a55] font-semibold hover:underline cursor-pointer"
        >
          <ExternalLink className="w-3 h-3" />
          Open in new tab
        </button>
      </div>
    </div>
  );
}
