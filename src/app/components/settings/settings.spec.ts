import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SettingsComponent } from './settings';
import { TrackingService } from '../../services/tracking';
import { signal } from '@angular/core';
import { App } from '../../app';

describe('SettingsComponent', () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;

  const mockTrackingService = {
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        { provide: TrackingService, useValue: mockTrackingService },
        { provide: App, useValue: {} },
        provideRouter([])
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
