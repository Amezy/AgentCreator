/**
 * @module adminStore
 * @description 管理员状态管理 Store（Zustand）。
 * 管理 Box 设备列表的全局状态，提供增删改查操作。
 * 用于向后兼容的桩模块，当前 box-system 不依赖 boxes 表。
 */
import { create } from 'zustand';
import type { BoxItem } from '../services/api';

interface AdminStore {
  /** Box 设备列表 */
  boxes: BoxItem[];
  /** 替换整个设备列表 */
  setBoxes: (boxes: BoxItem[]) => void;
  /** 添加单个设备 */
  addBox: (box: BoxItem) => void;
  /** 局部更新指定设备 */
  updateBox: (id: number, data: Partial<BoxItem>) => void;
  /** 删除指定设备 */
  removeBox: (id: number) => void;
  /** 数据加载状态 */
  loading: boolean;
  /** 设置加载状态 */
  setLoading: (loading: boolean) => void;
}

const useAdminStore = create<AdminStore>((set) => ({
  boxes: [],
  setBoxes: (boxes) => set({ boxes }),
  addBox: (box) => set((state) => ({ boxes: [...state.boxes, box] })),
  updateBox: (id, data) =>
    set((state) => ({
      boxes: state.boxes.map((b) => (b.id === id ? { ...b, ...data } : b)),
    })),
  removeBox: (id) =>
    set((state) => ({
      boxes: state.boxes.filter((b) => b.id !== id),
    })),
  loading: false,
  setLoading: (loading) => set({ loading }),
}));

export default useAdminStore;
