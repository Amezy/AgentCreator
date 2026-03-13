/**
 * @module Card
 * @description Material Design 3 卡片容器组件。
 * 提供三种样式变体：elevated（阴影抬升）、outlined（边框轮廓）、filled（填充背景）。
 */
import React from 'react';

/**
 * Card 组件属性
 * @property variant - 卡片样式变体：'elevated' | 'outlined' | 'filled'
 * @property children - 卡片内容
 * @property className - 附加的 CSS 类名
 */
interface CardProps {
  variant: 'elevated' | 'outlined' | 'filled';
  children: React.ReactNode;
  className?: string;
}

const Card: React.FC<CardProps> = ({ variant, children, className = '' }) => {
  const baseClasses = 'rounded-md p-6 font-roboto transition-shadow duration-200';

  const variantClasses = {
    elevated:
      'bg-surface-container-low shadow-elevation-1 hover:shadow-elevation-2',
    outlined:
      'bg-surface border border-outline-variant hover:shadow-elevation-1',
    filled:
      'bg-surface-container-highest',
  };

  return (
    <div className={`${baseClasses} ${variantClasses[variant]} ${className}`}>
      {children}
    </div>
  );
};

export default Card;
