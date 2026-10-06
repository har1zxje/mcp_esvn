/** Safe composition of work-management and HRM data.
 *
 * This deliberately reports domain summaries side by side. It never joins a
 * Plane member to an HRM employee: that requires an explicit, authorized
 * identity-mapping design that Mock HRM does not provide.
 */
export class CrossDomainService {
  constructor(workManagementService, hrmService) {
    if (!workManagementService || !hrmService) throw new Error('CrossDomainService requires work-management and HRM services.');
    this.workManagementService = workManagementService;
    this.hrmService = hrmService;
  }

  async getWorkforceOverview(options = {}) {
    const [progress, workload, employees] = await Promise.all([
      this.workManagementService.getProjectProgress({}, options),
      this.workManagementService.getTeamWorkload({}, options),
      this.hrmService.listEmployees(options),
    ]);
    const attendance = await Promise.all(employees.map((employee) => this.hrmService.getAttendance(employee.id, options).catch(() => [])));
    const balances = await Promise.all(employees.map((employee) => this.hrmService.getLeaveBalance(employee.id, options).catch(() => null)));
    return {
      work: { progress, assignedMemberCount: workload.length },
      hrm: {
        employeeCount: employees.length,
        employeeWithLeaveDataCount: balances.filter(Boolean).length,
        attendanceRecordCount: attendance.flat().length,
      },
      identityMapping: 'not_available',
    };
  }
}
