/**
 * @module Stepper
 * @description Material Design 3 步骤指示器组件。
 * 水平展示多步骤流程，已完成步骤显示勾选图标，
 * 当前步骤高亮，步骤之间通过连接线串联。支持点击已完成/当前步骤进行导航。
 */
import React from 'react';
import { CheckIcon } from '../icons/Icons';

/**
 * Stepper 组件属性
 * @property steps - 步骤标签数组
 * @property activeStep - 当前激活步骤索引（0-based）
 * @property onStepClick - 步骤点击回调，传入步骤索引
 */
interface StepperProps {
  steps: string[];
  activeStep: number;
  onStepClick?: (step: number) => void;
}

const Stepper: React.FC<StepperProps> = ({ steps, activeStep, onStepClick }) => {
  return (
    <div className="flex items-center w-full font-roboto px-4 py-3">
      {steps.map((step, index) => {
        const isCompleted = index < activeStep;
        const isActive = index === activeStep;
        const isClickable = onStepClick && (isCompleted || isActive);

        return (
          <React.Fragment key={index}>
            {/* Step Circle + Label */}
            <div
              className={`flex items-center gap-3 ${
                isClickable ? 'cursor-pointer' : 'cursor-default'
              }`}
              onClick={() => isClickable && onStepClick?.(index)}
            >
              {/* Circle */}
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 transition-colors duration-200 ${
                  isCompleted
                    ? 'bg-primary text-on-primary'
                    : isActive
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container-highest text-on-surface-variant'
                }`}
              >
                {isCompleted ? (
                  <CheckIcon size={18} />
                ) : (
                  <span className="label-medium">{index + 1}</span>
                )}
              </div>

              {/* Label */}
              <span
                className={`label-large whitespace-nowrap ${
                  isActive
                    ? 'text-primary'
                    : isCompleted
                    ? 'text-on-surface'
                    : 'text-on-surface-variant'
                }`}
              >
                {step}
              </span>
            </div>

            {/* Connector Line */}
            {index < steps.length - 1 && (
              <div className="flex-1 mx-3">
                <div
                  className={`h-[1px] transition-colors duration-200 ${
                    index < activeStep
                      ? 'bg-primary'
                      : 'bg-outline-variant'
                  }`}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default Stepper;
