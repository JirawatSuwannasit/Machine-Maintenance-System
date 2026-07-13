"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

export type MachineRecord = {
  id: string;
  machine_code: string;
  machine_name: string;
  category: string | null;
  location: string | null;
  status: string;
  model: string | null;
  serial_no: string | null;
  manufacturer: string | null;
  purchase_date: string | null;
  install_date: string | null;
  warranty_expiry: string | null;
};

type MachineFormProps = {
  machine?: MachineRecord;
  onSuccess: () => void;
};

const CATEGORY_PRESETS = ["TS", "TH", "TE", "VI", "CMM", "TENSILE", "DURA"];
const OTHER_CATEGORY_VALUE = "__other__";

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "active", label: "ใช้งาน" },
  { value: "inactive", label: "ไม่ใช้งาน" },
  { value: "scrapped", label: "ปลดระวาง" },
];

const inputClassName =
  "mt-1 block w-full min-h-[44px] rounded-md border border-primary/20 px-3 py-2 text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

const sectionHeadingClassName =
  "border-b border-primary/10 pb-1 text-sm font-semibold text-primary/70";

function initialCategorySelect(machine: MachineRecord | undefined): string {
  if (!machine?.category) return "";
  return CATEGORY_PRESETS.includes(machine.category)
    ? machine.category
    : OTHER_CATEGORY_VALUE;
}

function initialCategoryOther(machine: MachineRecord | undefined): string {
  if (!machine?.category) return "";
  return CATEGORY_PRESETS.includes(machine.category) ? "" : machine.category;
}

// Inspects a Postgres unique-violation error to decide which field it
// belongs to. Both the error message ("...unique constraint
// "machines_serial_no_key"") and details ("Key (serial_no)=(...) already
// exists.") contain the column/constraint name, so checking either is
// enough to identify the offending field.
function identifyDuplicateField(
  message: string,
  details: string | null | undefined
): "machine_code" | "serial_no" | null {
  const text = `${message} ${details ?? ""}`.toLowerCase();
  if (text.includes("serial_no")) return "serial_no";
  if (text.includes("machine_code")) return "machine_code";
  return null;
}

export default function MachineForm({ machine, onSuccess }: MachineFormProps) {
  const router = useRouter();
  const isEditMode = machine !== undefined;

  const [machineCode, setMachineCode] = useState(machine?.machine_code ?? "");
  const [machineName, setMachineName] = useState(machine?.machine_name ?? "");
  const [categorySelect, setCategorySelect] = useState(
    initialCategorySelect(machine)
  );
  const [categoryOther, setCategoryOther] = useState(
    initialCategoryOther(machine)
  );
  const [location, setLocation] = useState(machine?.location ?? "");
  const [status, setStatus] = useState(machine?.status ?? "active");

  const [manufacturer, setManufacturer] = useState(
    machine?.manufacturer ?? ""
  );
  const [model, setModel] = useState(machine?.model ?? "");
  const [serialNo, setSerialNo] = useState(machine?.serial_no ?? "");
  const [purchaseDate, setPurchaseDate] = useState(
    machine?.purchase_date ?? ""
  );
  const [installDate, setInstallDate] = useState(machine?.install_date ?? "");
  const [warrantyExpiry, setWarrantyExpiry] = useState(
    machine?.warranty_expiry ?? ""
  );

  const [machineCodeError, setMachineCodeError] = useState<string | null>(
    null
  );
  const [machineNameError, setMachineNameError] = useState<string | null>(
    null
  );
  const [serialNoError, setSerialNoError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function resolveCategory(): string | null {
    if (categorySelect === "") return null;
    if (categorySelect === OTHER_CATEGORY_VALUE) {
      const trimmed = categoryOther.trim();
      return trimmed === "" ? null : trimmed;
    }
    return categorySelect;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedCode = machineCode.trim();
    const trimmedName = machineName.trim();

    let hasError = false;
    if (trimmedCode === "") {
      setMachineCodeError("กรุณากรอกรหัสเครื่อง");
      hasError = true;
    } else {
      setMachineCodeError(null);
    }
    if (trimmedName === "") {
      setMachineNameError("กรุณากรอกชื่อเครื่อง");
      hasError = true;
    } else {
      setMachineNameError(null);
    }

    if (hasError) return;

    setSubmitting(true);
    setFormError(null);
    setSerialNoError(null);

    const trimmedManufacturer = manufacturer.trim();
    const trimmedModel = model.trim();
    const trimmedSerialNo = serialNo.trim();

    const payload = {
      machine_code: trimmedCode,
      machine_name: trimmedName,
      category: resolveCategory(),
      location,
      status,
      manufacturer: trimmedManufacturer === "" ? null : trimmedManufacturer,
      model: trimmedModel === "" ? null : trimmedModel,
      serial_no: trimmedSerialNo === "" ? null : trimmedSerialNo,
      purchase_date: purchaseDate === "" ? null : purchaseDate,
      install_date: installDate === "" ? null : installDate,
      warranty_expiry: warrantyExpiry === "" ? null : warrantyExpiry,
    };

    const { error } = isEditMode
      ? await supabase.from("machines").update(payload).eq("id", machine.id)
      : await supabase.from("machines").insert(payload);

    if (error) {
      if (error.code === "23505") {
        const field = identifyDuplicateField(error.message, error.details);
        if (field === "machine_code") {
          setMachineCodeError("รหัสเครื่องนี้มีอยู่แล้ว");
        } else if (field === "serial_no") {
          setSerialNoError("หมายเลขเครื่อง S/N นี้มีอยู่แล้ว");
        } else {
          setFormError(error.message);
        }
      } else {
        setFormError(error.message);
      }
      setSubmitting(false);
      return;
    }

    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-6">
      <div className="space-y-4">
        <h2 className={sectionHeadingClassName}>ข้อมูลเครื่องจักร</h2>

        <div>
          <label htmlFor="machine_code" className="block text-sm font-medium">
            รหัสเครื่อง*
          </label>
          <input
            id="machine_code"
            type="text"
            value={machineCode}
            onChange={(event) => setMachineCode(event.target.value)}
            className={inputClassName}
          />
          {machineCodeError && (
            <p className="mt-1 text-sm text-red-700">{machineCodeError}</p>
          )}
        </div>

        <div>
          <label htmlFor="machine_name" className="block text-sm font-medium">
            ชื่อเครื่อง*
          </label>
          <input
            id="machine_name"
            type="text"
            value={machineName}
            onChange={(event) => setMachineName(event.target.value)}
            className={inputClassName}
          />
          {machineNameError && (
            <p className="mt-1 text-sm text-red-700">{machineNameError}</p>
          )}
        </div>

        <div>
          <label htmlFor="category" className="block text-sm font-medium">
            ประเภท
          </label>
          <select
            id="category"
            value={categorySelect}
            onChange={(event) => setCategorySelect(event.target.value)}
            className={inputClassName}
          >
            <option value="">-- เลือกประเภท --</option>
            {CATEGORY_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {preset}
              </option>
            ))}
            <option value={OTHER_CATEGORY_VALUE}>อื่นๆ</option>
          </select>
          {categorySelect === OTHER_CATEGORY_VALUE && (
            <input
              type="text"
              value={categoryOther}
              onChange={(event) => setCategoryOther(event.target.value)}
              placeholder="ระบุประเภท"
              className={`${inputClassName} mt-2`}
            />
          )}
        </div>

        <div>
          <label htmlFor="location" className="block text-sm font-medium">
            ตำแหน่ง/Line
          </label>
          <input
            id="location"
            type="text"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            className={inputClassName}
          />
        </div>

        <div>
          <label htmlFor="status" className="block text-sm font-medium">
            สถานะ
          </label>
          <select
            id="status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={inputClassName}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className={sectionHeadingClassName}>ข้อมูลทรัพย์สิน</h2>

        <div>
          <label htmlFor="manufacturer" className="block text-sm font-medium">
            ยี่ห้อ/ผู้ผลิต
          </label>
          <input
            id="manufacturer"
            type="text"
            value={manufacturer}
            onChange={(event) => setManufacturer(event.target.value)}
            className={inputClassName}
          />
        </div>

        <div>
          <label htmlFor="model" className="block text-sm font-medium">
            รุ่น
          </label>
          <input
            id="model"
            type="text"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className={inputClassName}
          />
        </div>

        <div>
          <label htmlFor="serial_no" className="block text-sm font-medium">
            หมายเลขเครื่อง S/N
          </label>
          <input
            id="serial_no"
            type="text"
            value={serialNo}
            onChange={(event) => setSerialNo(event.target.value)}
            className={inputClassName}
          />
          {serialNoError && (
            <p className="mt-1 text-sm text-red-700">{serialNoError}</p>
          )}
        </div>

        <div>
          <label htmlFor="purchase_date" className="block text-sm font-medium">
            วันที่ซื้อ
          </label>
          <input
            id="purchase_date"
            type="date"
            value={purchaseDate}
            onChange={(event) => setPurchaseDate(event.target.value)}
            className={inputClassName}
          />
        </div>

        <div>
          <label htmlFor="install_date" className="block text-sm font-medium">
            วันติดตั้ง
          </label>
          <input
            id="install_date"
            type="date"
            value={installDate}
            onChange={(event) => setInstallDate(event.target.value)}
            className={inputClassName}
          />
        </div>

        <div>
          <label
            htmlFor="warranty_expiry"
            className="block text-sm font-medium"
          >
            วันหมดประกัน
          </label>
          <input
            id="warranty_expiry"
            type="date"
            value={warrantyExpiry}
            onChange={(event) => setWarrantyExpiry(event.target.value)}
            className={inputClassName}
          />
        </div>
      </div>

      {formError && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {formError}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting ? "กำลังบันทึก..." : "บันทึก"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-primary/20 px-4 text-sm font-medium text-primary hover:bg-primary/5"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
}
