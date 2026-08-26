import React, { useMemo, useState } from 'react';
import { Film, Folder, ChevronRight, ChevronDown } from 'lucide-react';
import { usePaintStore } from '../../store/usePaintStore';
import { FileTreeNode, buildTreeFromPaths } from '../../engine/fileTree';

interface RollTreeItemProps {
  node: FileTreeNode;
  depth: number;
  currentPath: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

const RollTreeItem: React.FC<RollTreeItemProps> = ({
  node,
  depth,
  currentPath,
  expanded,
  onToggle,
  onSelect,
}) => {
  if (node.isFolder) {
    const isOpen = expanded.has(node.path);
    return (
      <div>
        <div
          onClick={() => onToggle(node.path)}
          style={{ paddingLeft: `${depth * 10 + 2}px` }}
          className="flex items-center gap-1 py-0.5 rounded cursor-pointer text-[10px] text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 select-none"
        >
          {isOpen ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
          <Folder className="w-3 h-3 flex-shrink-0 text-indigo-500" />
          <span className="truncate">{node.name}</span>
        </div>
        {isOpen &&
          node.children?.map((child) => (
            <RollTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              currentPath={currentPath}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
      </div>
    );
  }

  const isCurrent = node.path === currentPath;
  return (
    <div
      onClick={() => onSelect(node.path)}
      title={node.path}
      style={{ paddingLeft: `${depth * 10 + 2}px` }}
      className={`flex items-center gap-1 py-0.5 rounded cursor-pointer text-[10px] select-none transition-colors ${
        isCurrent
          ? 'bg-indigo-600 text-white font-bold shadow-xs'
          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
      }`}
    >
      <Film className="w-3 h-3 flex-shrink-0" />
      <span className="truncate">{node.name}</span>
    </div>
  );
};

/**
 * 読み込んだフォルダに入っているロールの一覧。
 *
 * 1 つのフォルダに複数のロールを入れて順に確認する運用があるため、
 * セルのファイルツリーと同じ場所から選べるようにしている。
 *
 * ⚠️ セルのツリー (TreeItemNode) を使い回さないこと。あちらはコマ番号・複数選択・
 * リネームや削除の右クリックまで抱えており、ロールには当てはまらない。
 */
export const RollFileTree: React.FC = () => {
  const files = usePaintStore((s) => s.roll.files);
  const currentPath = usePaintStore((s) => s.roll.currentPath);
  const folderName = usePaintStore((s) => s.roll.folderName);
  const selectRollFile = usePaintStore((s) => s.selectRollFile);

  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 並びは collectDroppedVideoFiles が決めた順 (浅い階層が先、その中は自然順)
  const nodes = useMemo(() => buildTreeFromPaths(files.map((v) => v.path)), [files]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // 初めて出たときはフォルダを開いた状態にしておく
  const expandedWithDefaults = useMemo(() => {
    if (expanded.size > 0) return expanded;
    const all = new Set<string>();
    const walk = (list: FileTreeNode[]) => {
      for (const n of list) {
        if (n.isFolder) {
          all.add(n.path);
          if (n.children) walk(n.children);
        }
      }
    };
    walk(nodes);
    return all;
  }, [expanded, nodes]);

  if (files.length === 0) return null;

  return (
    <div className="flex-shrink-0 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
      <div
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-1 px-1.5 py-1 cursor-pointer select-none text-[10px] font-bold text-indigo-700 dark:text-indigo-300 hover:bg-slate-200/60 dark:hover:bg-slate-800"
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        <Film className="w-3 h-3" />
        <span className="truncate">ロール {folderName ? `(${folderName})` : ''}</span>
        <span className="ml-auto text-[9px] font-normal opacity-80">{files.length} 本</span>
      </div>

      {!collapsed && (
        <div className="max-h-40 overflow-y-auto px-1 pb-1 space-y-0.5">
          {nodes.map((node) => (
            <RollTreeItem
              key={node.path}
              node={node}
              depth={0}
              currentPath={currentPath}
              expanded={expandedWithDefaults}
              onToggle={toggle}
              onSelect={selectRollFile}
            />
          ))}
        </div>
      )}
    </div>
  );
};
