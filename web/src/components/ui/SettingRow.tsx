import type { ReactNode } from 'react';
import { InfoTooltip } from './InfoTooltip';

export type SettingRowInfo = {
  content: ReactNode;
  label?: string;
};

/// One label-and-control line inside a settings panel.
///
/// The row is a grid rather than a space-between flex line because the label has to be the part
/// that reflows: a flex line lets a rigid control keep its intrinsic width and paint the label
/// underneath it. Here the label column is the only flexible track, so a long label wraps instead
/// of colliding with its control.
///
/// Rows whose control side is a pair (a select next to a button, say) cannot share a line with the
/// label at medium widths without starving it. Those pass `className="setting-row-stacked"` to put
/// the controls on their own row. The optional description sits under the label and explains the
/// effect in plain language, so the row does not depend on a tooltip for essential context.
export function SettingRow({ label, description, descriptionId, info, className = '', children }: {
  label: ReactNode;
  description?: ReactNode;
  descriptionId?: string;
  info?: SettingRowInfo;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`setting-row ${className}`.trim()}>
      <div className="setting-text">
        <span className="setting-label-wrap">
          <span className="setting-label-content">{label}</span>
          {info && <InfoTooltip content={info.content} label={info.label} />}
        </span>
        {description && <span className="setting-description" id={descriptionId}>{description}</span>}
      </div>
      <div className="setting-controls-wrap">{children}</div>
    </div>
  );
}
