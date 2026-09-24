export function getAuthenticatedOwnerId(req) {
  const id = req.user?.id;
  if (!id) throw new Error('Authenticated user is required');
  return String(id);
}

export function ownsConversation(conversation, req) {
  if (!conversation) return false;
  return conversation.ownerId === getAuthenticatedOwnerId(req);
}
