import { useState } from "react";
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  UserIcon,
  PhoneIcon,
  EnvelopeIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import ConfirmModal from "../shared/ConfirmModal";

interface Contact {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  is_primary: boolean;
}

interface LenderContactListProps {
  lenderId: string;
  contacts: Contact[];
  onUpdate: () => void;
}

interface ContactFormData {
  name: string;
  title: string;
  email: string;
  phone: string;
  is_primary: boolean;
}

const initialFormData: ContactFormData = {
  name: "",
  title: "",
  email: "",
  phone: "",
  is_primary: false,
};

export default function LenderContactList({
  lenderId,
  contacts,
  onUpdate,
}: LenderContactListProps) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [formData, setFormData] = useState<ContactFormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<Contact | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleOpenForm = (contact?: Contact) => {
    if (contact) {
      setEditingContact(contact);
      setFormData({
        name: contact.name,
        title: contact.title || "",
        email: contact.email || "",
        phone: contact.phone || "",
        is_primary: contact.is_primary || false,
      });
    } else {
      setEditingContact(null);
      setFormData(initialFormData);
    }
    setIsFormOpen(true);
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingContact(null);
    setFormData(initialFormData);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setIsSubmitting(true);
    try {
      // Get current contacts from lender
      const { data: lenderData, error: fetchError } = await supabase
        .from("lenders")
        .select("contacts")
        .eq("id", lenderId)
        .single();

      if (fetchError) throw fetchError;

      let updatedContacts: Contact[] = lenderData?.contacts || [];

      if (editingContact) {
        // Update existing contact
        updatedContacts = updatedContacts.map((c) =>
          c.id === editingContact.id
            ? { ...c, ...formData }
            : formData.is_primary && c.is_primary
              ? { ...c, is_primary: false }
              : c
        );
      } else {
        // Add new contact
        const newContact: Contact = {
          id: crypto.randomUUID(),
          ...formData,
        };

        // If this is marked as primary, unset other primary contacts
        if (formData.is_primary) {
          updatedContacts = updatedContacts.map((c) => ({
            ...c,
            is_primary: false,
          }));
        }

        updatedContacts.push(newContact);
      }

      // Update lender with new contacts
      const { error: updateError } = await supabase
        .from("lenders")
        .update({ contacts: updatedContacts })
        .eq("id", lenderId);

      if (updateError) throw updateError;

      // If marked as primary, also update primary_contact fields
      if (formData.is_primary) {
        await supabase
          .from("lenders")
          .update({
            primary_contact_name: formData.name,
            primary_contact_email: formData.email,
            primary_contact_phone: formData.phone,
          })
          .eq("id", lenderId);
      }

      onUpdate();
      handleCloseForm();
    } catch (error) {
      console.error("Error saving contact:", error);
      alert("Failed to save contact. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = (contact: Contact) => {
    setContactToDelete(contact);
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!contactToDelete) return;

    setIsDeleting(true);
    try {
      // Get current contacts from lender
      const { data: lenderData, error: fetchError } = await supabase
        .from("lenders")
        .select("contacts")
        .eq("id", lenderId)
        .single();

      if (fetchError) throw fetchError;

      const currentContacts: Contact[] = lenderData?.contacts || [];
      const updatedContacts = currentContacts.filter((c) => c.id !== contactToDelete.id);

      // Update lender with filtered contacts
      const { error: updateError } = await supabase
        .from("lenders")
        .update({ contacts: updatedContacts })
        .eq("id", lenderId);

      if (updateError) throw updateError;

      // If deleted contact was primary, clear primary fields
      if (contactToDelete.is_primary) {
        await supabase
          .from("lenders")
          .update({
            primary_contact_name: null,
            primary_contact_email: null,
            primary_contact_phone: null,
          })
          .eq("id", lenderId);
      }

      onUpdate();
    } catch (error) {
      console.error("Error deleting contact:", error);
      alert("Failed to delete contact. Please try again.");
    } finally {
      setIsDeleting(false);
      setDeleteModalOpen(false);
      setContactToDelete(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">
          Contacts ({contacts.length})
        </h3>
        <button
          onClick={() => handleOpenForm()}
          className="btn-primary text-sm flex items-center gap-2"
        >
          <PlusIcon className="w-4 h-4" />
          Add Contact
        </button>
      </div>

      {/* Contact List */}
      {contacts.length === 0 ? (
        <div className="text-center py-8 bg-gray-50 dark:bg-gray-900 rounded-lg">
          <UserIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">No contacts added yet</p>
          <button
            onClick={() => handleOpenForm()}
            className="text-ocean-blue hover:underline text-sm mt-2"
          >
            Add your first contact
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {contacts.map((contact) => (
            <div
              key={contact.id}
              className="flex items-start justify-between p-4 bg-gray-50 dark:bg-gray-900 rounded-lg"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-ocean-blue/10 flex items-center justify-center">
                  <UserIcon className="w-5 h-5 text-ocean-blue" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-white">
                      {contact.name}
                    </span>
                    {contact.is_primary && (
                      <span className="px-2 py-0.5 text-xs bg-mint-green/20 text-mint-green rounded-full">
                        Primary
                      </span>
                    )}
                  </div>
                  {contact.title && (
                    <p className="text-sm text-gray-500">{contact.title}</p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-sm">
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="flex items-center gap-1 text-ocean-blue hover:underline"
                      >
                        <EnvelopeIcon className="w-4 h-4" />
                        {contact.email}
                      </a>
                    )}
                    {contact.phone && (
                      <a
                        href={`tel:${contact.phone}`}
                        className="flex items-center gap-1 text-ocean-blue hover:underline"
                      >
                        <PhoneIcon className="w-4 h-4" />
                        {contact.phone}
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleOpenForm(contact)}
                  className="p-2 text-gray-400 hover:text-ocean-blue hover:bg-white dark:hover:bg-gray-800 rounded-lg"
                  title="Edit"
                >
                  <PencilIcon className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDeleteClick(contact)}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-white dark:hover:bg-gray-800 rounded-lg"
                  title="Delete"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Contact Form Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {editingContact ? "Edit Contact" : "Add Contact"}
              </h3>
              <button
                onClick={handleCloseForm}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input-field"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="input-field"
                  placeholder="e.g., Account Manager"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="input-field"
                  placeholder="contact@lender.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="input-field"
                  placeholder="(555) 123-4567"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_primary"
                  checked={formData.is_primary}
                  onChange={(e) => setFormData({ ...formData, is_primary: e.target.checked })}
                  className="rounded border-gray-300 text-ocean-blue focus:ring-ocean-blue"
                />
                <label htmlFor="is_primary" className="text-sm text-gray-700 dark:text-gray-300">
                  Set as primary contact
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={handleCloseForm}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !formData.name.trim()}
                  className="btn-primary text-sm disabled:opacity-50"
                >
                  {isSubmitting ? "Saving..." : editingContact ? "Save" : "Add Contact"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
        title="Delete Contact"
        message={`Are you sure you want to delete "${contactToDelete?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
