-- AgentCreator 预置数据
-- 依赖 schema.sql 先执行

-- 预置岗位
INSERT INTO positions (id, name, category, min_level, default_level, description, is_preset) VALUES
('pos_sys_arch', '系统架构师', 'engineering', 'senior', 'senior', '负责系统整体架构设计、技术选型和架构评审', 1),
('pos_dev', '软件开发', 'engineering', 'junior', 'mid', '负责软件功能开发、代码编写和单元测试', 1),
('pos_test', '测试工程师', 'engineering', 'junior', 'mid', '负责测试用例设计、自动化测试和质量保障', 1),
('pos_pm', '产品经理', 'engineering', 'mid', 'mid', '负责需求分析、产品规划和用户故事编写', 1),
('pos_consult_mgr', '咨询经理', 'consulting', 'mid', 'mid', '负责咨询项目管理、方案撰写和客户沟通', 1),
('pos_analyst', '行业分析师', 'consulting', 'junior', 'junior', '负责行业分析、竞品调研和数据分析', 1);

-- 预置技能（工程类）
INSERT INTO skills (id, name, description, category, complexity, recommended_model_tier, applicable_positions, applicable_min_level, is_preset, instructions, opencode_tools) VALUES
('skill_code_gen', '代码生成', '根据需求描述生成高质量代码', 'engineering', 'medium', 'medium', '["pos_dev", "pos_test"]', 'junior', 1,
 '# 代码生成

## 执行流程
1. 理解用户的需求描述
2. 分析现有代码结构和风格
3. 生成符合项目规范的代码
4. 添加必要的注释和文档

## 输出要求
- 代码风格与项目一致
- 包含错误处理
- 遵循 DRY 原则',
 '["read","write","edit","grep","glob","bash"]'),
('skill_code_review', '代码审查', '审查代码质量、安全性和最佳实践', 'engineering', 'medium', 'medium', '["pos_dev", "pos_sys_arch"]', 'mid', 1,
 '# 代码审查

## 审查维度
1. **代码质量**: 命名规范、函数长度、圈复杂度
2. **安全性**: 注入风险、敏感数据暴露、权限检查
3. **性能**: 不必要的循环、内存泄漏、N+1 查询
4. **可维护性**: 文档、测试覆盖、模块耦合度

## 输出格式
- 按严重程度分级：Critical / Warning / Suggestion
- 每条包含：位置、问题描述、修改建议',
 '["read","grep","glob","bash"]'),
('skill_tdd', 'TDD测试驱动', '测试驱动开发，先写测试再写实现', 'engineering', 'medium', 'medium', '["pos_dev", "pos_test"]', 'mid', 1,
 '# TDD 测试驱动开发

## 执行流程
1. 理解功能需求
2. 编写失败的测试用例（Red）
3. 编写最少代码使测试通过（Green）
4. 重构代码保持测试通过（Refactor）',
 '["read","write","edit","bash","grep"]'),
('skill_arch_design', '架构设计', '系统架构设计、组件划分和技术方案', 'engineering', 'complex', 'advanced', '["pos_sys_arch", "pos_pm"]', 'senior', 1,
 '# 架构设计

## 设计流程
1. 理解业务需求和约束条件
2. 分析现有系统架构
3. 设计组件划分和接口定义
4. 评估技术方案的利弊
5. 输出架构文档',
 '["read","write","grep","glob","bash","webfetch","websearch"]'),
('skill_deep_search', '深度搜索', '联网深度搜索和信息检索分析', 'general', 'complex', 'advanced', '["pos_sys_arch", "pos_analyst", "pos_consult_mgr"]', 'mid', 1,
 '# 深度搜索

## 执行流程
1. 理解搜索目标和关键词
2. 执行多轮搜索，交叉验证信息
3. 筛选和整理相关结果
4. 生成结构化的搜索报告',
 '["webfetch","websearch","read","write"]'),
('skill_brainstorm', '脑力风暴', '多角度创意发散和方案评估', 'general', 'complex', 'advanced', '["pos_sys_arch", "pos_pm", "pos_consult_mgr"]', 'senior', 1,
 '# 脑力风暴

## 执行流程
1. 明确问题定义和约束
2. 从多个角度发散思维
3. 评估每个方案的利弊
4. 推荐最优方案并说明理由',
 '["read","write","webfetch","websearch"]'),
('skill_req_analysis', '需求分析', '业务需求分析和用户故事编写', 'engineering', 'medium', 'medium', '["pos_pm"]', 'mid', 1,
 '# 需求分析

## 执行流程
1. 理解业务背景和用户痛点
2. 提取功能性和非功能性需求
3. 编写用户故事
4. 定义验收标准',
 '["read","write"]'),
('skill_test_design', '测试用例设计', '设计测试用例和测试方案', 'engineering', 'basic', 'basic', '["pos_test"]', 'junior', 1,
 '# 测试用例设计

## 设计方法
1. 等价类划分
2. 边界值分析
3. 因果图法
4. 场景法',
 '["read","write"]'),
('skill_auto_test', '自动化测试', '编写自动化测试脚本和CI集成', 'engineering', 'medium', 'medium', '["pos_test"]', 'mid', 1,
 '# 自动化测试

## 执行流程
1. 分析被测功能和接口
2. 选择合适的测试框架
3. 编写自动化测试脚本
4. 配置 CI 集成',
 '["read","write","edit","bash","grep"]');

-- 预置技能（咨询类）
INSERT INTO skills (id, name, description, category, complexity, recommended_model_tier, applicable_positions, applicable_min_level, is_preset, instructions, opencode_tools) VALUES
('skill_industry_analysis', '行业分析', '行业趋势分析和市场研究', 'consulting', 'medium', 'medium', '["pos_analyst", "pos_consult_mgr"]', 'junior', 1,
 '# 行业分析

## 分析框架
1. 行业概况（市场规模、增长率）
2. 竞争格局
3. 趋势洞察
4. 机会与风险评估',
 '["webfetch","websearch","read","write"]'),
('skill_competitor', '竞品分析', '竞品调研和对标分析', 'consulting', 'medium', 'medium', '["pos_analyst"]', 'junior', 1,
 '# 竞品分析

## 分析维度
1. 产品功能对比
2. 定价策略
3. 技术架构
4. 用户评价',
 '["webfetch","websearch","read","write"]'),
('skill_proposal', '方案撰写', '咨询方案和报告撰写', 'consulting', 'complex', 'advanced', '["pos_consult_mgr"]', 'mid', 1,
 '# 方案撰写

## 结构模板
1. 项目背景与目标
2. 现状分析
3. 解决方案
4. 实施路径与里程碑
5. 风险评估与缓解',
 '["read","write","webfetch","websearch"]'),
('skill_client_research', '客户调研', '客户需求调研和访谈分析', 'consulting', 'basic', 'basic', '["pos_analyst", "pos_consult_mgr"]', 'junior', 1,
 '# 客户调研

## 调研方法
1. 设计调研问卷
2. 整理访谈记录
3. 提取关键洞察
4. 生成调研报告',
 '["read","write"]'),
('skill_data_collection', '数据收集', '搜索和整理相关数据资料', 'consulting', 'basic', 'basic', '["pos_analyst"]', 'junior', 1,
 '# 数据收集

## 执行流程
1. 明确数据需求
2. 搜索公开数据源
3. 清洗和整理数据
4. 生成数据摘要',
 '["webfetch","websearch","read","write"]'),
('skill_report_writing', '报告撰写', '整理和撰写分析报告', 'consulting', 'basic', 'basic', '["pos_analyst"]', 'junior', 1,
 '# 报告撰写

## 撰写规范
1. 结构清晰（总分总）
2. 数据支撑论点
3. 图表辅助说明
4. 可执行的建议',
 '["read","write"]');
