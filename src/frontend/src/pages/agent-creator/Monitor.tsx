/**
 * @module Monitor
 * @description 监控页面 - 展示数字员工的运行状态、任务执行记录和资源消耗统计。
 */
import React from 'react';
import Card from '../../components/m3/Card';

const Monitor: React.FC = () => {
  return (
    <div className="h-full flex flex-col font-roboto">
      {/* 页面标题 */}
      <div className="mb-6">
        <h2 className="title-large text-on-surface">监控中心</h2>
        <p className="body-medium text-on-surface-variant mt-1">
          实时查看数字员工的运行状态、任务执行日志和资源消耗情况
        </p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card variant="filled">
          <p className="label-medium text-on-surface-variant">运行中员工</p>
          <p className="headline-medium text-on-surface mt-1">0</p>
        </Card>
        <Card variant="filled">
          <p className="label-medium text-on-surface-variant">今日任务数</p>
          <p className="headline-medium text-on-surface mt-1">0</p>
        </Card>
        <Card variant="filled">
          <p className="label-medium text-on-surface-variant">Token 消耗</p>
          <p className="headline-medium text-on-surface mt-1">0</p>
        </Card>
      </div>

      {/* 任务日志 */}
      <div className="flex-1 overflow-hidden">
        <Card variant="outlined" className="h-full flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="title-small text-on-surface">任务执行日志</h3>
            <span className="label-small text-on-surface-variant">实时更新</span>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-on-surface-variant/30 mx-auto mb-3">
                <path d="M19.88 18.47c.44-.7.7-1.51.7-2.39 0-2.49-2.01-4.5-4.5-4.5s-4.5 2.01-4.5 4.5 2.01 4.5 4.5 4.5c.88 0 1.69-.26 2.39-.7L21.58 23 23 21.58l-3.12-3.11zm-3.8.11c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zm-.36-8.5c-.74.02-1.45.18-2.1.45l-.55-.83-3.8 6.18-3.01-3.52-3.63 5.81L1 17l5-8 3 3.5L13 6l2.72 4.08z" fill="currentColor"/>
              </svg>
              <p className="body-medium text-on-surface-variant">暂无执行记录</p>
              <p className="body-small text-on-surface-variant/60 mt-1">数字员工开始工作后，执行日志将在此实时展示</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Monitor;
