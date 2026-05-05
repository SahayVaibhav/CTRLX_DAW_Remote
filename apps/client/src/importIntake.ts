import JSZip from "jszip";

export type ImportArchiveUpload = {
  sourceKind: "zip" | "folder";
  sourceName: string;
  archive: Blob;
};

function getRelativeFilePath(file: File): string {
  const relativePath =
    typeof file.webkitRelativePath === "string" && file.webkitRelativePath.trim().length > 0
      ? file.webkitRelativePath
      : file.name;
  return relativePath.replace(/^\/+/, "");
}

export async function buildImportArchiveFromZipFile(file: File): Promise<ImportArchiveUpload> {
  return {
    sourceKind: "zip",
    sourceName: file.name,
    archive: file
  };
}

export async function buildImportArchiveFromFolderFiles(
  files: Iterable<File>
): Promise<ImportArchiveUpload> {
  const allFiles = Array.from(files);
  const zip = new JSZip();

  for (const file of allFiles) {
    zip.file(getRelativeFilePath(file), file);
  }

  const sourceName = allFiles[0]?.webkitRelativePath?.split("/")[0] || "Selected Folder";
  const archive = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: {
      level: 6
    }
  });

  return {
    sourceKind: "folder",
    sourceName: `${sourceName}.zip`,
    archive
  };
}
