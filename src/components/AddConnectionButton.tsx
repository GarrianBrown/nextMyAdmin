"use client";

import { useState } from "react";
import AddConnectionModal from "./AddConnectionModal";
import { PlusIcon } from "./icons";

export default function AddConnectionButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-primary text-sm" onClick={() => setOpen(true)}>
        <PlusIcon style={{ width: 14, height: 14 }} />
        Add Connection
      </button>
      {open && <AddConnectionModal onClose={() => setOpen(false)} />}
    </>
  );
}
