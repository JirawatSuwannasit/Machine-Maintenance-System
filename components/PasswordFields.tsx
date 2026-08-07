const minimumPasswordLength = 8;

export default function PasswordFields({
  newPassword,
  confirmPassword,
  onNewPassword,
  onConfirmPassword,
}: {
  newPassword: string;
  confirmPassword: string;
  onNewPassword: (value: string) => void;
  onConfirmPassword: (value: string) => void;
}) {
  return (
    <>
      <div>
        <label htmlFor="new-password" className="block text-sm font-medium">
          รหัสผ่านใหม่
        </label>
        <input id="new-password" type="password" required minLength={minimumPasswordLength} autoComplete="new-password" value={newPassword} onChange={(event) => onNewPassword(event.target.value)} className="mt-1 min-h-[44px] w-full rounded-md border border-primary/20 px-3 py-2 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        <p className="mt-1 text-xs text-primary/60">อย่างน้อย {minimumPasswordLength} ตัวอักษร</p>
      </div>
      <div>
        <label htmlFor="confirm-password" className="block text-sm font-medium">
          ยืนยันรหัสผ่านใหม่
        </label>
        <input id="confirm-password" type="password" required minLength={minimumPasswordLength} autoComplete="new-password" value={confirmPassword} onChange={(event) => onConfirmPassword(event.target.value)} className="mt-1 min-h-[44px] w-full rounded-md border border-primary/20 px-3 py-2 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
      </div>
    </>
  );
}
