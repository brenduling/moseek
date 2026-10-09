export const MEANINGFUL_ACTIVITY_ACTIONS = [
  'environment_created', 'environment_updated', 'environment_type_changed',
  'contributor_added', 'contributor_removed', 'contributor_role_changed',
  'contributor_invited', 'invitation_accepted', 'invitation_declined', 'invitation_revoked', 'invitation_expired',
  'join_request_created', 'join_request_accepted', 'join_request_declined', 'join_request_revoked', 'join_request_expired',
  'section_created', 'section_renamed', 'section_deleted',
  'resource_created', 'resource_updated', 'resource_deleted', 'file_uploaded', 'image_uploaded',
  'calendar_item_created', 'calendar_item_updated', 'calendar_item_deleted', 'calendar_status_changed',
  'section_discussion_created', 'section_discussion_deleted',
]

export const ACTIVITY_LABELS = {
  environment_created: 'Environment created', environment_updated: 'Environment details updated',
  environment_type_changed: 'Environment type changed', contributor_added: 'Contributor joined',
  contributor_removed: 'Contributor removed', contributor_role_changed: 'Contributor role changed',
  contributor_invited: 'Contributor invited', invitation_accepted: 'Invitation accepted',
  invitation_declined: 'Invitation declined', invitation_revoked: 'Invitation revoked', invitation_expired: 'Invitation expired',
  join_request_created: 'Join request received', join_request_accepted: 'Join request approved',
  join_request_declined: 'Join request declined', join_request_revoked: 'Join request revoked', join_request_expired: 'Join request expired',
  section_created: 'Section created', section_renamed: 'Section renamed', section_deleted: 'Section removed',
  resource_created: 'Resource added', resource_updated: 'Resource updated', resource_deleted: 'Resource removed',
  file_uploaded: 'File added', image_uploaded: 'Image added', calendar_item_created: 'Calendar item added',
  calendar_item_updated: 'Calendar item updated', calendar_item_deleted: 'Calendar item removed',
  calendar_status_changed: 'Task progress updated', section_discussion_created: 'Section Discussion added',
  section_discussion_deleted: 'Section Discussion removed',
}

export const ACTIVITY_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function activityDescription(item) {
  return ACTIVITY_LABELS[item.action] || 'Environment updated'
}
