import { useTranslation } from "react-i18next";
import { FocusTrap } from "./FocusTrap";

export interface EncryptionWarning {
  /** An i18n key, resolved here. Both callers pass one of the
   *  `dm.encryption_warning.*` messages. */
  messageKey: string;
  /** Present only when there is something to consent to. Absent makes this a
   *  notice with a single dismiss button — "the message was not sent" needs
   *  no decision. */
  onConfirm?: () => void;
  onCancel: () => void;
}

/** The one place a DM stops and asks before leaving unencrypted.
 *
 *  Nothing else in the client can say this: by the time a message is rendered
 *  it has already gone, and a badge after the fact is not consent. The hub is
 *  the party end-to-end encryption defends against
 *  (decisions.md, "a hub holds what you signed or encrypted"), so a message it
 *  can read is a different promise from the one the product makes — and the
 *  user is the only one who can decide to make it anyway. */
export function EncryptionWarningModal({ messageKey, onConfirm, onCancel }: EncryptionWarning) {
  const { t } = useTranslation();

  return (
    <div
      className="modal-overlay"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={t("dm.encryption_warning.title")}
    >
      <FocusTrap>
        <div
          className="modal encryption-warning-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <h3>{t("dm.encryption_warning.title")}</h3>
          <p>{t(messageKey)}</p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={onCancel}>
              {onConfirm ? t("modal.cancel") : t("modal.dismiss")}
            </button>
            {onConfirm && (
              // Not btn-primary: sending in the clear is the riskier of the
              // two buttons, and it should not be the one the eye lands on.
              <button className="btn-secondary danger" onClick={onConfirm}>
                {t("dm.encryption_warning.send_anyway")}
              </button>
            )}
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}
