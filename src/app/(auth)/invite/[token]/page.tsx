import { verifyToken } from "@/server/tokens";
import { db } from "@/server/db";
import { InviteForm } from "../../auth-forms";
import { AuthShellError } from "../../_error";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  let invite;
  try {
    const payload = verifyToken("invitation", decodeURIComponent(token));
    const row = await db.invitation.findUnique({
      where: { id: payload.s },
      include: {
        org: { select: { name: true } },
        invitedBy: { select: { name: true } },
      },
    });
    if (!row || row.status !== "PENDING" || row.expiresAt < new Date()) {
      invite = null;
    } else {
      const role = await db.role.findUnique({ where: { code: row.roleCode } });
      invite = {
        email: row.email,
        orgName: row.org.name,
        roleName: role?.name ?? row.roleCode,
        invitedBy: row.invitedBy.name,
      };
    }
  } catch {
    invite = null;
  }
  if (!invite) {
    return <AuthShellError title="Invitation not valid" message="This invitation was revoked, expired or the link is incorrect. Ask your admin to send a new one." />;
  }
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Join {invite.orgName}</h1>
      <p className="mb-6 text-sm text-zinc-500">You&apos;ve been invited to collaborate on OmniMark.</p>
      <InviteForm {...invite} token={token} />
    </div>
  );
}
