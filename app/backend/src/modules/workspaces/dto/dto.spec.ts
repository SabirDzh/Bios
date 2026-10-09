import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateWorkspaceDto } from './create-workspace.dto';
import { WorkspaceIdDto } from './workspace-id.dto';
import { InviteMemberDto } from './invite-member.dto';
import { AcceptInvitationDto } from './accept-invitation.dto';

const V7 = '01912345-6789-7abc-aef0-1234567890ab';
const V4 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const B64URL43 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn0-_';

async function errorsOf(
  cls: new () => object,
  input: object,
): Promise<string[]> {
  const dto = plainToInstance(cls, input);
  const errors = await validate(dto);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('workspace DTOs', () => {
  test('name: blank and 65 chars rejected, normal accepted', async () => {
    expect(await errorsOf(CreateWorkspaceDto, { name: '   ' })).not.toEqual([]);
    expect(
      await errorsOf(CreateWorkspaceDto, { name: 'a'.repeat(65) }),
    ).not.toEqual([]);
    expect(await errorsOf(CreateWorkspaceDto, { name: 'ab' })).toEqual([]);
  });

  test('workspaceId: only uuid v7', async () => {
    expect(await errorsOf(WorkspaceIdDto, { workspaceId: 'nope' })).not.toEqual(
      [],
    );
    expect(await errorsOf(WorkspaceIdDto, { workspaceId: V4 })).not.toEqual([]);
    expect(await errorsOf(WorkspaceIdDto, { workspaceId: V7 })).toEqual([]);
  });

  test('invite email: shape-only, no disposable/MX checks', async () => {
    expect(
      await errorsOf(InviteMemberDto, { email: 'no-at-sign' }),
    ).not.toEqual([]);
    // Одноразовая почта здесь валидна: политику почты инвайтам не навязываем.
    expect(
      await errorsOf(InviteMemberDto, { email: 'user@mailinator.com' }),
    ).toEqual([]);
    expect(await errorsOf(InviteMemberDto, { email: 'A@B.CD' })).toEqual([]);
  });

  test('accept token: exactly 43 base64url chars', async () => {
    expect(await errorsOf(AcceptInvitationDto, { token: V7 })).not.toEqual([]);
    expect(
      await errorsOf(AcceptInvitationDto, { token: B64URL43.slice(0, 42) }),
    ).not.toEqual([]);
    expect(await errorsOf(AcceptInvitationDto, { token: B64URL43 })).toEqual(
      [],
    );
  });
});
