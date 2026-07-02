import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  formatTime,
  type FileEntry,
  type DirectoryEntry,
} from "@/lib/api";
import { FileDetailDialog } from "@/components/FileDetailDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import {
  Folder,
  FileText,
  Layers,
  Clock,
  Upload,
  Loader2,
  ArrowLeft,
  FolderPlus,
} from "lucide-react";

function FileIcon({ canBePrinted }: { canBePrinted: boolean }) {
  if (canBePrinted) return <Layers className="h-4 w-4 text-primary" />;
  return <FileText className="h-4 w-4 text-muted-foreground" />;
}

export default function Files() {
  const [currentPath, setCurrentPath] = useState(".");
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  type CamSize = 'MAX' | 'MID' | 'MIN' | 'HIDE';

  // Initialize the page-specific camera size immediately.
  const [camSize, setCamSize] = useState<CamSize>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('mariner_cam_size_files');
      if (saved === 'MAX' || saved === 'MID' || saved === 'MIN' || saved === 'HIDE') {
        return saved as CamSize;
      }
    }
    return 'MIN';
  });

  // Ignore repeated clicks for the active size.
  const handleSizeChange = async (size: CamSize) => {
    // Only update when the size actually changes.
    if (size === camSize) return;

    setCamSize(size);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('mariner_cam_size_files', size);
    }

    try {
      const action = size === 'HIDE' ? 'stop' : 'start';
      await fetch(`/api/camera/${action}`, { method: 'POST' });
    } catch (error) {
      console.error("Failed to toggle the camera service:", error);
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ["files", currentPath],
    queryFn: () => api.listFiles(currentPath),
  });

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => api.createDirectory(currentPath, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files", currentPath] });
      toast.success("Folder created");
      setNewFolderOpen(false);
      setNewFolderName("");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Could not create folder");
    },
  });

  useEffect(() => {
    if (!newFolderOpen) setNewFolderName("");
  }, [newFolderOpen]);

  const handleDirectoryClick = (dirname: string) => {
    if (dirname === "..") {
      setCurrentPath((prev) => {
        const parts = prev.split("/").filter(Boolean);
        parts.pop();
        return parts.length === 0 ? "." : parts.join("/");
      });
    } else {
      setCurrentPath((prev) => (prev === "." ? dirname : `${prev}/${dirname}`));
    }
  };

  const handleFileClick = (file: FileEntry) => {
    setSelectedFile(file);
    setDialogOpen(true);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await api.uploadFile(file, currentPath);
    queryClient.invalidateQueries({ queryKey: ["files", currentPath] });
    e.target.value = "";
  };

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    createFolderMutation.mutate(name);
  };

  return (
    <div className="container pt-2 pb-2">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">File Manager</h1>
          <p className="text-sm text-muted-foreground">
            {currentPath === "." ? "/" : `/${currentPath}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setNewFolderOpen(true)}
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New folder</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Upload</span>
          </Button>
        </div>
      </div>
      {/* Live camera stream controls. */}
      <div className="cam-wrapper-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '16px', width: '100%' }}>
  
  <div className="cam-control-bar" style={{
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: camSize === 'MAX' ? '1296px' : camSize === 'MID' ? '800px' : camSize === 'MIN' ? '480px' : '100%',
    maxWidth: '100%',
    backgroundColor: '#111',
    padding: '6px 12px',
    borderRadius: camSize === 'HIDE' ? '6px' : '6px 6px 0 0',
    border: '2px solid #222',
    borderBottom: camSize === 'HIDE' ? '2px solid #222' : 'none',
    boxSizing: 'border-box',
    transition: 'width 0.3s ease'
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#aaa', fontWeight: 'bold' }}>
      <span id="files-led" style={{ 
        width: '10px', 
        height: '10px', 
        borderRadius: '50%', 
        backgroundColor: camSize === 'HIDE' ? '#64748b' : '#22c55e', 
        display: 'inline-block',
        boxShadow: camSize === 'HIDE' ? 'none' : '0 0 8px #22c55e',
        transition: 'background-color 0.3s'
      }} />
      <span id="files-text">{camSize === 'HIDE' ? 'Camera: Off' : 'Camera: On'}</span>
    </div>

    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' }}>
      {([ 'MAX', 'MID', 'MIN', 'HIDE' ] as CamSize[]).map((size) => (
        <button
          key={size}
          onClick={() => handleSizeChange(size)}
          style={{
            padding: '3px 10px',
            fontSize: '10px',
            backgroundColor: camSize === size ? '#2563eb' : '#222',
            color: '#fff',
            border: camSize === size ? '1px solid #60a5fa' : '1px solid #444',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 'bold',
            letterSpacing: '0.5px',
            transition: 'all 0.2s'
          }}
        >
          {size}
        </button>
      ))}
    </div>
  </div>

  {/* Remove the iframe entirely when the stream is hidden. */}
  {camSize !== 'HIDE' && (
    <div className="cam-frame-container" style={{
      width: camSize === 'MAX' ? '1296px' : camSize === 'MID' ? '800px' : '480px',
      maxWidth: '100%',     
      aspectRatio: '4 / 3', 
      overflow: 'hidden', 
      borderRadius: '0 0 8px 8px',
      border: '2px solid #222',
      boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
      backgroundColor: '#000',
      transition: 'width 0.3s ease'
    }}>
      <iframe 
        src={typeof window !== 'undefined' ? `http://${window.location.hostname}:8889/cam` : ''}
        title="Printer Files View"
        scrolling="no"
        style={{ width: '100%', height: '100%', border: 'none', display: 'block', overflow: 'hidden' }}
      />
    </div>
  )}
</div>

      <div className="rounded-lg border bg-card">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-2 text-sm text-muted-foreground">
              Loading files...
            </span>
          </div>
        ) : (
          <div className="divide-y">
            {currentPath !== "." && (
              <button
                onClick={() => handleDirectoryClick("..")}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
              >
                <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />
                <Folder className="h-4 w-4 text-primary" />
                <span className="font-medium">..</span>
              </button>
            )}
            {data?.directories.map((dir: DirectoryEntry) => (
              <button
                key={dir.dirname}
                onClick={() => handleDirectoryClick(dir.dirname)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
              >
                <Folder className="h-4 w-4 text-primary" />
                <span className="font-medium">{dir.dirname}</span>
              </button>
            ))}
            {data?.files.map((file: FileEntry) => (
              <button
                key={file.filename}
                onClick={() => handleFileClick(file)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
              >
                <FileIcon canBePrinted={file.can_be_printed} />
                <span className="min-w-0 flex-1 truncate font-mono text-sm">
                  {file.filename}
                </span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {file.print_time_secs && (
                    <span className="hidden items-center gap-1 sm:flex">
                      <Clock className="h-3 w-3" />
                      {formatTime(file.print_time_secs)}
                    </span>
                  )}
                  {file.can_be_printed && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase text-primary">
                      print
                    </span>
                  )}
                </div>
              </button>
            ))}
            {data && data.directories.length === 0 && data.files.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No files found in this directory.
              </div>
            )}
          </div>
        )}
      </div>

      <FileDetailDialog
        file={selectedFile}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Create a folder in{" "}
              <span className="font-mono text-foreground">
                {currentPath === "." ? "/" : `/${currentPath}`}
              </span>
              .
            </DialogDescription>
          </DialogHeader>
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateFolder();
            }}
            placeholder="Folder name"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setNewFolderOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!newFolderName.trim() || createFolderMutation.isPending}
              onClick={handleCreateFolder}
            >
              {createFolderMutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Creatingâ€¦
                </>
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

