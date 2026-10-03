"use client";

import { ActionButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { deleteDocumentAction } from "@/app/actions/admin";

export function DeleteDoc({ id, name }: { id: string; name: string }) {
  return <ActionButton action={deleteDocumentAction.bind(null, id)} className="btn btn-sm btn-ghost icon-btn" confirm={`Delete ${name}?`}><Icon name="trash" /><span className="sr-only">Delete {name}</span></ActionButton>;
}
